import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCombatSlotViewModel } from "../../../game/viewModels.js";
import { buildPositionTooltipEntries } from "../../../utils/tooltip-entries.js";

/**
 * The board's render contract.
 *
 * Every snapshot is the whole board, and the board used to rebuild every card
 * for it: measured across a turn change, the hand was painted half-built (its
 * card count dipped below the real hand five times), the deck stack was
 * re-created 20 cards per side per update, and roughly 270 tooltips were
 * mounted per update. A turn change delivers several snapshots in a row, so the
 * screen flashed. The page is DOM code without a harness, so the two rules that
 * keep that from happening are pinned here.
 *
 * The board's placement slots are pinned here too. They come from the placement
 * registry the positions route serves beside the position catalog, and the rule
 * that decides which slot a dragged card reveals is the card's resolved
 * `deployLines` against the slot's `lines`. The page is DOM code with no
 * importable boundary (it imports browser-absolute paths and boots on
 * DOMContentLoaded), so the rule is evaluated from the page's own source rather
 * than restated here, and the wiring that mounts the slots is verified in the
 * browser.
 *
 * The Shinheuh combat slot is pinned the same way, one level up: the slot
 * renderer is evaluated from its own source against stand-in elements, so the
 * gating, the seat coverage, the icon and the spent marking are read off the
 * page's renderer instead of described in prose here.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const source = fs.readFileSync(path.join(root, "public/pages/game/script.js"), "utf-8");

/** The body of one renderer, from its declaration to its closing brace. */
const rendererBody = (name) => {
  const start = source.indexOf(`const ${name} = `);
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error(`renderer ${name} not found`);
  return source.slice(start, end);
};

/**
 * One module-level pure helper, evaluated from its own source so this suite
 * pins the rule the page runs instead of a copy of it.
 */
const helperFromSource = (name) => {
  const start = source.indexOf(`const ${name} = `);
  const end = source.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error(`helper ${name} not found`);
  return new Function(`${source.slice(start, end + 3)}\nreturn ${name};`)();
};

const matchPlacementSlot = helperFromSource("matchPlacementSlot");
const replacesFieldUnit = helperFromSource("replacesFieldUnit");

/** A registry slot in the shape the positions route serves. */
const slot = (code, kind, line) => ({
  code,
  kind,
  lines: [line],
  name: code,
  iconPath: `/assets/icons/positions/${code}.png`,
});

/** The placement registry, per line, in the shape the payload carries. */
const PLACEMENT = {
  frontline: [
    slot("fisherman", "standard", "frontline"),
    slot("scout", "standard", "frontline"),
    slot("wave-controller", "standard", "frontline"),
    slot("shinheuh", "shinheuh", "frontline"),
  ],
  backline: [
    slot("spear-bearer", "standard", "backline"),
    slot("light-bearer", "standard", "backline"),
    slot("shinheuh", "shinheuh", "backline"),
    slot("landmark", "landmark", "backline"),
  ],
};

/** The slots a card reveals, applied the way the page's reveal applies it. */
const revealed = (card, placement = PLACEMENT) =>
  Object.entries(placement).flatMap(([line, slots]) =>
    slots
      .filter((candidate) => matchPlacementSlot(card, candidate))
      .map((candidate) => `${line}:${candidate.kind}:${candidate.code}`)
  );

/** The reveal as it read before the registry: the card's own printed positions. */
const printed = (card) => {
  const codes = Object.keys(card.positions ?? {});
  return Object.entries(PLACEMENT).flatMap(([line, slots]) =>
    slots
      .filter((candidate) => codes.includes(candidate.code))
      .map((candidate) => `${line}:${candidate.kind}:${candidate.code}`)
  );
};

const STANDARD_CARD = { kind: "standard", positions: { fisherman: {}, scout: {} }, deployLines: ["frontline"] };
const LANDMARK_CARD = { kind: "landmark", positions: {}, deployLines: ["backline"] };
const SHINHEUH_CARD = { kind: "shinheuh", line: "frontline", positions: {}, deployLines: ["frontline"] };

/* ── the combat-slot renderer, evaluated from its own source ───────────── */

/**
 * The page's mounted-element registry and its combat-slot renderer, from
 * `mountedElements` down to the end of `renderCombatSlots`. Everything in the
 * block is a declaration, so it evaluates as a unit and the renderer it ends
 * with is the page's own rather than a copy.
 */
const COMBAT_SLOT_BLOCK = (() => {
  const start = source.indexOf("const mountedElements = new WeakMap();");
  const end = source.indexOf("const buildDeckBack = ");
  if (start < 0 || end < 0) throw new Error("the page's combat-slot block was not found");
  return source.slice(start, end);
})();

/**
 * A stand-in element. The registry work needs children, a class list, and a
 * style and dataset bag. This is everything `appendChild`, `remove`,
 * `orderChildren` and `dropUnwanted` touch, and nothing a browser adds.
 */
const fakeElement = () => {
  const classes = new Set();
  const element = {
    children: [],
    dataset: {},
    style: {},
    parent: null,
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      contains: (name) => classes.has(name),
      toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)),
    },
    appendChild(child) {
      if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
      child.parent = element;
      element.children.push(child);
      return child;
    },
    remove() {
      if (!element.parent) return;
      element.parent.children.splice(element.parent.children.indexOf(element), 1);
      element.parent = null;
    },
  };
  return element;
};

/** The five position codes a seat's `combatSlotCodes` carries. */
const POSITION_CODES = ["fisherman", "spear-bearer", "scout", "light-bearer", "wave-controller"];

/**
 * One seat's wire state: the five position slots plus the Shinheuh flags under
 * test. `undefined` leaves the field off the payload, which is how the
 * opponent's view reads until the server ships the field there too.
 */
const seat = (shinheuhSlot) => ({
  combatSlotCodes: POSITION_CODES,
  combatSlots: Object.fromEntries(POSITION_CODES.map((code) => [code, { available: true }])),
  ...(shinheuhSlot === undefined ? {} : { shinheuhSlot }),
});

const NO_SLOT = seat(undefined);
const GRANTED = { available: true, used: false };
const SPENT = { available: false, used: true };

const SHINHEUH_ICON = "/assets/icons/positions/shinheuh.png";

// The slot's copy is server-owned, so the payload's fields are sentinels: a
// title or a body authored in the page would fail the tooltip test.
const GLOSSARY = {
  kinds: { shinheuh: { name: "Payload name", description: "Payload description." } },
};

/**
 * The page's `renderCombatSlots` mounted against the stand-ins, reading the two
 * real view builders and recording every `addTooltip` call.
 */
const combatSlots = (glossary = GLOSSARY) => {
  const containers = { you: fakeElement(), opponent: fakeElement() };
  const tooltips = [];
  const document = {
    createElement: () => fakeElement(),
    querySelector: (selector) => containers[selector.startsWith("#you-container .") ? "you" : "opponent"],
  };
  const renderCombatSlots = new Function(
    "document",
    "addTooltip",
    "buildCombatSlotViewModel",
    "buildPositionTooltipEntries",
    `${COMBAT_SLOT_BLOCK}\nreturn renderCombatSlots;`
  )(
    document,
    (hoverContainer, title, texts, iconPath) => {
      tooltips.push({ hoverContainer, title, texts, iconPath });
      return Promise.resolve();
    },
    buildCombatSlotViewModel,
    buildPositionTooltipEntries
  );
  return {
    containers,
    tooltips,
    render: (state) => renderCombatSlots(state, {}, glossary),
    codes: (player) => containers[player].children.map((child) => child.dataset.positionCode),
  };
};

const RENDERERS = ["renderDecks", "renderFields", "renderHands", "renderCombatSlots"];

describe("board rendering", () => {
  test.each(RENDERERS)("%s never empties its container", (name) => {
    // clearing the container is what made the hand blink through a half-built
    // state and re-mounted every tooltip in it
    expect(rendererBody(name)).not.toMatch(/innerHTML\s*=\s*""/);
  });

  test.each(RENDERERS)("%s reconciles the elements it mounted", (name) => {
    const body = rendererBody(name);
    expect(body).toContain("elementsOf(");
    expect(body).toContain("dropUnwanted(");
  });

  test("a snapshot arriving mid-render replaces the pending one", () => {
    const schedule = source.slice(
      source.indexOf("let pendingState = null"),
      source.indexOf("socket.on(EVENTS.GAME_INIT, scheduleRender)")
    );

    expect(schedule).toContain("pendingState = payload");
    expect(schedule).toMatch(/if \(rendering\) return;/);
    expect(schedule).toMatch(/while \(pendingState\)/);
  });

  test("the deck stack costs no component mount", () => {
    expect(rendererBody("renderDecks")).not.toContain("loadComponent(");
  });

  test("a unit card is remounted only when what it shows changed", () => {
    expect(rendererBody("renderFields")).toMatch(/if \(mounted\.signature !== signature\)/);
  });

  test("a hand press that never moved turns the card over", () => {
    // mousedown clones the drag ghost, so the card itself never sees a click
    // event and the page is what turns it over
    expect(source).toContain("DRAG_THRESHOLD_PX");
    expect(source).toMatch(/if \(!moved\) toggleCardFlip\(cardDiv\)/);
  });

  test("the card the press landed on is hidden only once the drag starts", () => {
    // hiding it on mousedown took it out of hit testing: it stopped matching
    // `:hover`, and the browser does not re-hit-test until the pointer moves
    // again, so the card stayed at its un-hovered size under a motionless cursor
    const drag = source.slice(source.indexOf("const beginCardDrag ="), source.indexOf("const renderHands ="));
    expect(drag).toMatch(/if \(!moved && Math\.hypot\([^)]*\) > DRAG_THRESHOLD_PX\) \{[\s\S]{0,120}cardDiv\.classList\.add\("invisible"\)/);
    // the drag's own lock keeps text under the ghost unselectable, and no longer
    // takes pointer events off the whole page
    expect(source).toMatch(/document\.body\.classList\.add\("dragging"\)/);
    expect(source).not.toContain("no-interaction");
  });
});

describe("the Shinheuh combat slot", () => {
  const shinheuhSlotViewModel = helperFromSource("buildShinheuhSlotViewModel");

  test("only a live slot counts as a slot", () => {
    // the wire always carries the field, and the shape it starts every seat in
    // is the one `revokeShinheuhSlot` leaves when no Anima stands on the board
    // and the one `resetShinheuhSlot` clears a spent slot back to: no slot,
    // never a spent one
    expect(shinheuhSlotViewModel(seat({ available: false, used: false }))).toBeNull();
    expect(shinheuhSlotViewModel(NO_SLOT)).toBeNull();
    expect(shinheuhSlotViewModel({ shinheuhSlot: null })).toBeNull();
    expect(shinheuhSlotViewModel({})).toBeNull();
    expect(shinheuhSlotViewModel(undefined)).toBeNull();
    // the two live shapes: granted by an Anima, then spent by a Shinheuh ability
    expect(shinheuhSlotViewModel(seat(GRANTED))).toEqual({ used: false });
    expect(shinheuhSlotViewModel(seat(SPENT))).toEqual({ used: true });
  });

  test("a seat without a slot gets no element and no placeholder", () => {
    const board = combatSlots();
    board.render({ you: NO_SLOT, opponent: NO_SLOT });
    for (const player of ["you", "opponent"]) expect(board.codes(player)).toEqual(POSITION_CODES);
    // the revoked shape earns no element either
    board.render({ you: seat({ available: false, used: false }), opponent: seat({ available: false, used: false }) });
    for (const player of ["you", "opponent"]) expect(board.codes(player)).toEqual(POSITION_CODES);
  });

  test("a granted slot mounts for both seats, unspent, on the generic icon", () => {
    const board = combatSlots();
    board.render({ you: seat(GRANTED), opponent: seat(GRANTED) });
    for (const player of ["you", "opponent"]) {
      expect(board.codes(player)).toEqual([...POSITION_CODES, "shinheuh"]);
      const element = board.containers[player].children.at(-1);
      expect(element.classList.contains("combat-slot")).toBe(true);
      expect(element.classList.contains("used")).toBe(false);
      // the slot is one resource, not tied to a line, so it paints the generic
      // icon rather than frontline-shinheuh.png / backline-shinheuh.png
      expect(element.children[0].style.backgroundImage).toBe(`url(${SHINHEUH_ICON})`);
    }
  });

  test("the tooltip is the payload's kind copy, with no line label", () => {
    const board = combatSlots();
    board.render({ you: seat(GRANTED), opponent: NO_SLOT });
    const shinheuhTooltips = board.tooltips.filter((tooltip) => tooltip.iconPath === SHINHEUH_ICON);
    expect(shinheuhTooltips).toHaveLength(1);
    const [tooltip] = shinheuhTooltips;
    expect(tooltip.title).toBe(GLOSSARY.kinds.shinheuh.name);
    expect(tooltip.texts).toEqual(buildPositionTooltipEntries(GLOSSARY.kinds.shinheuh, GLOSSARY));
    // the slot carries no line, so the position builder's line label is absent
    expect(tooltip.texts.some((entry) => entry.style === "label")).toBe(false);
  });

  test("a spent slot is marked with the position slots' own used class", () => {
    const board = combatSlots();
    board.render({ you: seat(SPENT), opponent: NO_SLOT });
    const element = board.containers.you.children.at(-1);
    expect(element.dataset.positionCode).toBe("shinheuh");
    expect(element.classList.contains("used")).toBe(true);
    // the spent seat renders it and the seat with none still does not
    expect(board.codes("opponent")).toEqual(POSITION_CODES);
  });

  test("the slot sits after the five position slots and moves none of them", () => {
    const board = combatSlots();
    board.render({ you: NO_SLOT, opponent: NO_SLOT });
    const without = board.codes("you");
    board.render({ you: seat(GRANTED), opponent: NO_SLOT });
    expect(board.codes("you")).toEqual([...without, "shinheuh"]);
  });

  test("re-rendering neither duplicates, drops, nor rebuilds it", () => {
    const board = combatSlots();
    board.render({ you: seat(GRANTED), opponent: NO_SLOT });
    const mounted = board.containers.you.children.at(-1);
    board.render({ you: seat(GRANTED), opponent: NO_SLOT });
    expect(board.codes("you")).toEqual([...POSITION_CODES, "shinheuh"]);
    expect(board.containers.you.children.at(-1)).toBe(mounted);
    // spending it keeps the element, since only what it shows changed
    board.render({ you: seat(SPENT), opponent: NO_SLOT });
    expect(board.containers.you.children.at(-1)).toBe(mounted);
    expect(mounted.classList.contains("used")).toBe(true);
    // losing it removes the element, and it comes back as a fresh one
    board.render({ you: NO_SLOT, opponent: NO_SLOT });
    expect(board.codes("you")).toEqual(POSITION_CODES);
    board.render({ you: seat(GRANTED), opponent: NO_SLOT });
    expect(board.containers.you.children.at(-1)).not.toBe(mounted);
  });

  test("the render path hands the slot renderer the glossary", () => {
    // without this the tooltip copy never reaches the slot in the browser
    expect(rendererBody("render")).toContain("renderCombatSlots(state, positions, data.glossary)");
  });
});

describe("board placement", () => {
  test("deployLines selects exactly the slots whose lines it reaches", () => {
    expect(revealed(SHINHEUH_CARD)).toEqual(["frontline:shinheuh:shinheuh"]);
    expect(revealed({ ...SHINHEUH_CARD, deployLines: ["backline"] })).toEqual(["backline:shinheuh:shinheuh"]);
    // a card that reaches both lines reaches each line's own slot
    expect(
      revealed({
        kind: "standard",
        positions: { fisherman: {}, "spear-bearer": {} },
        deployLines: ["frontline", "backline"],
      })
    ).toEqual(["frontline:standard:fisherman", "backline:standard:spear-bearer"]);
  });

  test("a standard card still reveals only the positions it prints", () => {
    expect(revealed(STANDARD_CARD)).toEqual(["frontline:standard:fisherman", "frontline:standard:scout"]);
    // the wave-controller sits on the frontline the card can reach, and the card
    // does not print it
    expect(revealed(STANDARD_CARD)).not.toContain("frontline:standard:wave-controller");
    expect(revealed({ kind: "standard", positions: { scout: {} }, deployLines: ["frontline"] })).toEqual([
      "frontline:standard:scout",
    ]);
  });

  test("a landmark card reveals the landmark slot", () => {
    expect(revealed(LANDMARK_CARD)).toEqual(["backline:landmark:landmark"]);
  });

  test("no conduit slot is ever revealed", () => {
    // the registry offers none: the Jeonsulsa engine summons a Conduit onto the
    // enemy backline, and no card puts one in a player's hand
    expect(Object.values(PLACEMENT).flat().some((candidate) => candidate.kind === "conduit")).toBe(false);
    // and a payload that offered one would answer none of these cards
    const withConduit = {
      ...PLACEMENT,
      backline: [...PLACEMENT.backline, slot("conduit", "conduit", "backline")],
    };
    for (const card of [STANDARD_CARD, LANDMARK_CARD, SHINHEUH_CARD]) {
      expect(revealed(card, withConduit)).not.toContain("backline:conduit:conduit");
    }
  });

  test("a reveal reverted to the card's printed positions misses the landmark and the shinheuh", () => {
    // for a standard unit the printed positions are the same answer
    expect(printed(STANDARD_CARD)).toEqual(revealed(STANDARD_CARD));
    // for a landmark or a shinheuh they are no answer at all
    expect(printed(LANDMARK_CARD)).toEqual([]);
    expect(revealed(LANDMARK_CARD)).toEqual(["backline:landmark:landmark"]);
    expect(printed(SHINHEUH_CARD)).toEqual([]);
    expect(revealed(SHINHEUH_CARD)).toEqual(["frontline:shinheuh:shinheuh"]);
  });

  test("a landmark on the field marks the landmark slot as replacing it", () => {
    const landmarkSlot = PLACEMENT.backline.find((candidate) => candidate.kind === "landmark");
    const shinheuhSlot = PLACEMENT.frontline.find((candidate) => candidate.kind === "shinheuh");
    expect(replacesFieldUnit(landmarkSlot, [{ card: { kind: "landmark" } }])).toBe(true);
    expect(replacesFieldUnit(landmarkSlot, [])).toBe(false);
    expect(replacesFieldUnit(landmarkSlot, [{ card: { kind: "shinheuh" } }])).toBe(false);
    expect(replacesFieldUnit(shinheuhSlot, [{ card: { kind: "landmark" } }])).toBe(false);
  });

  test("the drop targets are built from the placement registry", () => {
    const body = rendererBody("prepareBoard");
    expect(body).toMatch(/placement\?\.\[line\]/);
    // nothing finds a line's positions by filtering the payload's keys: the
    // registry's own key carries no `.line`
    expect(body).not.toMatch(/\.line === line/);
  });

  test("prepareBoard reconciles the slots it mounted, so a rebuild adds none", () => {
    const body = rendererBody("prepareBoard");
    expect(body).toMatch(/let mounted = registry\.get\(key\)/);
    expect(body).toContain("dropUnwanted(");
    expect(body).toContain("orderChildren(");
    // the landmark's replacement marking is board state, so the slots are
    // rebuilt from the render path rather than once at boot
    expect(rendererBody("render")).toContain("prepareBoard(");
  });
});

describe("drag cleanup", () => {
  test("a drag that ends outside a target leaves no dragged hand id behind", () => {
    const start = source.indexOf("const clearDraggedHandIds = ");
    const cleanup = source.slice(start, source.indexOf("\n};", start));
    for (const name of ["draggedCardHandId", "draggedSkillHandId", "draggedEquipmentHandId"]) {
      expect(cleanup).toContain(`${name} = null;`);
    }
    // every drag ends through it, so a card released over the player's own side
    // cannot leave an id for the next click to play
    const drag = source.slice(source.indexOf("const beginCardDrag ="), source.indexOf("const renderHands ="));
    expect(drag).toMatch(/cleanupDropTargets\(\);\s*clearDraggedHandIds\(\);/);
  });
});
