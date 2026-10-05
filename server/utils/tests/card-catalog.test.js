import { createGameServer } from "../../createGameServer.js";
import { readdirSync } from "node:fs";
import cardsData from "../../data/cards.json" with { type: "json" };
import positionsSource from "../../data/positions.json" with { type: "json" };
import glossarySource from "../../data/glossary.json" with { type: "json" };
import GameState from "../../game/GameState.js";
import { getGlossaryView, getPlacementRegistry, getPositions } from "../../game/displayCatalogs.js";
import { deployLinesFor } from "../../game/placement.js";
import { cards } from "../../game/tests/fixtures/cards.js";
import { segmentsToPlainText } from "../../../public/utils/card-text.js";
import { buildPositionTooltipEntries } from "../../../public/utils/tooltip-entries.js";
import { buildCatalogViews, findOrphanArtworks } from "../card-catalog.js";
import { isTestCard } from "../test-card.js";

const unitEntry = {
  cardId: 10,
  type: "unit",
  name: "Ashen Knight",
  cost: 3,
  hp: 40,
  kind: "standard",
  positions: ["scout"],
  traits: [{ code: "lethal" }],
  attributes: ["hwayeomsa"],
  affiliations: ["fug"],
  abilities: [],
  passives: [],
  artworkPath: "/assets/images/artworks/ashen_knight.png",
};

const skillEntry = {
  cardId: 11,
  type: "skill",
  name: "Falling Petal",
  cost: 2,
  effects: [{ type: "deal_damage", text: ["Deal 2 damage."] }],
};

const testEntry = {
  cardId: 12,
  type: "unit",
  name: "_Test Phantom",
  cost: 1,
  hp: 10,
};

const nearMissEntry = {
  cardId: 13,
  type: "skill",
  name: "Testian Ritual",
  cost: 2,
  effects: [],
};

const catalog = {
  10: unitEntry,
  11: skillEntry,
  12: testEntry,
  13: nearMissEntry,
};

describe("isTestCard", () => {
  test("matches the _Test name prefix case-insensitively", () => {
    expect(isTestCard({ name: "_Test Phantom" })).toBe(true);
    expect(isTestCard({ name: "_test phantom" })).toBe(true);
  });

  test("does not match names that merely contain or resemble the prefix", () => {
    expect(isTestCard({ name: "Testian Ritual" })).toBe(false);
    expect(isTestCard({ name: "Testing Grounds" })).toBe(false);
    expect(isTestCard(unitEntry)).toBe(false);
  });

  test("rejects cards without a usable name", () => {
    expect(isTestCard({})).toBe(false);
    expect(isTestCard({ name: 42 })).toBe(false);
    expect(isTestCard(null)).toBe(false);
  });
});

describe("buildCatalogViews", () => {
  test("excludes test cards by default and keeps near-misses", () => {
    const views = buildCatalogViews(catalog);
    expect(views.map((view) => view.name)).toEqual(["Ashen Knight", "Falling Petal", "Testian Ritual"]);
  });

  test("includes test cards when asked", () => {
    const views = buildCatalogViews(catalog, { includeTest: true });
    expect(views.map((view) => view.name)).toContain("_Test Phantom");
    expect(views).toHaveLength(4);
  });

  test("projects views through Card.toSanitizedObject, not raw entries", () => {
    const [view] = buildCatalogViews({ 10: unitEntry });
    expect(view.cardId).toBe(10);
    expect(view.maxHp).toBe(40); // compiled `hp` becomes the client `maxHp`
    expect(view.abilities).toEqual([]);
    expect(view.passiveAbilities).toEqual([]); // compiled `passives` renames
    expect(view.traits.lethal).toMatchObject({
      name: "Lethal",
      iconPath: "/assets/icons/traits/lethal.png",
    }); // stamped from the trait registry; `flattenCard` adds the code client-side
    expect(view.affiliations.fug).toMatchObject({ name: "FUG" });
    expect(view.artworkPath).toBe("/assets/images/artworks/ashen_knight.png");
    expect(view.cost).toBe(3);
    expect(view.owner).toBeNull();
  });

  test("ships the compiler's display segments and relatedCards stamp", () => {
    const stamped = { ...skillEntry, relatedCards: [{ cardId: 10, kind: "mentioned-in", peerCardId: 11 }] };
    const [view] = buildCatalogViews({ 11: stamped });

    expect(view.effects).toEqual([["Deal 2 damage."]]);
    expect(view.relatedCards).toEqual([{ cardId: 10, kind: "mentioned-in", peerCardId: 11 }]);
  });

  test("throws no test-card views into orphan computations implicitly", () => {
    // Views carry artworkPath only when the compiler stamped it; a view built
    // from an entry without artwork claims nothing.
    const [skillView] = buildCatalogViews({ 11: skillEntry });
    expect(skillView.artworkPath).toBeNull();
  });
});

describe("deckEligible", () => {
  const unreachable = {
    cardId: 20,
    type: "unit",
    name: "Conduit Form",
    cost: 1,
    hp: 5,
    deckConstraints: [{ type: "unreachable" }],
  };
  const pickable = { cardId: 21, type: "unit", name: "Pickable", cost: 1, hp: 5, deckConstraints: [] };

  test("marks Unreachable cards ineligible and leaves the rest eligible", () => {
    const views = buildCatalogViews({ 20: unreachable, 21: pickable });
    expect(views.map((view) => [view.cardId, view.deckEligible])).toEqual([
      [20, false],
      [21, true],
    ]);
  });
});

describe("findOrphanArtworks", () => {
  const views = [
    { name: "Ashen Knight", artworkPath: "/assets/images/artworks/ashen_knight.png" },
    { name: "Bare Card", artworkPath: null },
    { name: "Weird", artworkPath: "relative\\path\\windows_style.png" },
  ];

  test("returns artwork files no card claims", () => {
    const files = ["ashen_knight.png", "unclaimed_art.png", "windows_style.png"];
    expect(findOrphanArtworks(views, files)).toEqual(["unclaimed_art.png"]);
  });

  test("claims nothing when no card carries artwork", () => {
    expect(findOrphanArtworks([{ name: "Bare", artworkPath: null }], ["a.png"])).toEqual(["a.png"]);
  });

  test("ignores non-png names only as far as the caller passed them", () => {
    expect(findOrphanArtworks(views, ["notes.txt", "unclaimed.png"])).toEqual(["notes.txt", "unclaimed.png"]);
  });
});

/**
 * The placement registry composed once for the whole suite. Every assertion
 * below reads it, so a composition failure surfaces once instead of per test.
 */
const placements = getPlacementRegistry();
const registrySlots = (line) => placements[line] ?? [];
const slotsOfKind = (line, kind) => registrySlots(line).filter((slot) => slot.kind === kind);
const POSITION_KINDS = new Set(["standard", "shinheuh", "landmark", "conduit"]);

/** The icons the position folder actually ships, read once on first use. */
let shippedIcons = null;
const shippedPositionIcons = () => {
  if (!shippedIcons) {
    const directory = new URL("../../../public/assets/icons/positions/", import.meta.url);
    shippedIcons = new Set(
      readdirSync(directory).map((name) => `/assets/icons/positions/${name}`)
    );
  }
  return shippedIcons;
};

/**
 * Every field a slot carries, so an extra one is as loud as a missing one. The
 * two shapes differ by the kind's own copy: a position slot stands for a
 * position the drop resolves to and the chip reads that copy from the position
 * entry it already carries, while a kind slot carries the kind's description
 * because nothing else on the client holds it.
 */
const POSITION_SLOT_FIELDS = ["code", "iconPath", "kind", "lines", "name"];
const KIND_SLOT_FIELDS = ["code", "description", "iconPath", "kind", "lines", "name"];
const slotFields = (kind) => (kind === "standard" ? POSITION_SLOT_FIELDS : KIND_SLOT_FIELDS);

/** Every kind slot on a line: the registry's non-standard slots. */
const kindSlotsOn = (line) => registrySlots(line).filter((slot) => slot.kind !== "standard");

describe("placement registry", () => {
  test("lists every position as a standard slot on its own line", () => {
    for (const [code, position] of Object.entries(positionsSource)) {
      const slot = registrySlots(position.line).find((candidate) => candidate.code === code);
      expect(slot).toBeDefined();
      expect(slot).toMatchObject({
        code,
        kind: "standard",
        lines: [position.line],
        name: position.name,
      });
      // A position slot's icon is the position catalog's own, which is what the
      // board already painted before the registry existed.
      expect(slot.iconPath).toBe(`/assets/icons/positions/${code}.png`);
    }
  });

  test("composes position slots before kind slots on every line", () => {
    for (const line of ["frontline", "backline"]) {
      const kinds = registrySlots(line).map((slot) => slot.kind);
      expect(kinds.length).toBeGreaterThan(0);
      expect(kinds.indexOf("standard")).toBe(0);
      const lastPosition = kinds.lastIndexOf("standard");
      const firstKind = kinds.findIndex((kind) => kind !== "standard");
      // Every position slot precedes the first kind slot; a line with no kind
      // slot is trivially ordered.
      if (firstKind !== -1) expect(lastPosition).toBeLessThan(firstKind);
    }
  });

  test("shapes every slot as its position or kind field set", () => {
    for (const line of ["frontline", "backline"]) {
      for (const slot of registrySlots(line)) {
        expect(Object.keys(slot).sort()).toEqual(slotFields(slot.kind));
        expect(POSITION_KINDS.has(slot.kind)).toBe(true);
        expect(typeof slot.code).toBe("string");
        expect(slot.code).not.toBe("");
        expect(slot.name).toEqual(expect.any(String));
        expect(slot.name).not.toBe("");
        expect(Array.isArray(slot.lines)).toBe(true);
        // Whatever shape a slot is, it accepts the one line it sits on.
        expect(slot.lines).toEqual([line]);
        // Every icon the board paints exists, or degrades to the shared
        // placeholder; a slot never carries an unresolvable path.
        expect(
          shippedPositionIcons().has(slot.iconPath) ||
            slot.iconPath === "/assets/images/placeholder.png"
        ).toBe(true);
      }
    }
  });

  test("offers each position code on exactly one line and never twice", () => {
    for (const code of Object.keys(positionsSource)) {
      const lines = ["frontline", "backline"].filter((line) =>
        registrySlots(line).some((slot) => slot.code === code)
      );
      expect(lines).toEqual([positionsSource[code].line]);
    }
  });

  test("accepts each standard slot's own line through the deploy rule", () => {
    for (const line of ["frontline", "backline"]) {
      for (const slot of slotsOfKind(line, "standard")) {
        // The position catalog is the rule's third argument; without it a
        // position code is resolved against the card's own printed positions.
        expect(deployLinesFor({ kind: slot.kind }, slot.code, positionsSource)).toEqual([line]);
      }
    }
  });

  test("lands the landmark slot on the backline and nowhere else", () => {
    expect(slotsOfKind("frontline", "landmark")).toEqual([]);

    const [landmark] = slotsOfKind("backline", "landmark");
    expect(landmark).toBeDefined();
    expect(landmark).toMatchObject({
      code: "landmark",
      kind: "landmark",
      lines: ["backline"],
      name: "Landmark",
      iconPath: "/assets/icons/positions/landmark.png",
    });
    // The accepted lines are the deploy rule's answer for that kind, not a
    // second hand-maintained list.
    expect(landmark.lines).toEqual(deployLinesFor({ kind: "landmark" }));
  });

  test("accepts only the lines the deploy rule allows for every kind slot", () => {
    for (const line of ["frontline", "backline"]) {
      for (const slot of registrySlots(line).filter((candidate) => candidate.kind !== "standard")) {
        expect(slot.lines).toEqual(deployLinesFor({ kind: slot.kind, line }));
      }
    }
  });

  test("carries one kind slot per hand-deployable kind, per line, and never the conduit", () => {
    const kindSlots = ["frontline", "backline"].flatMap((line) =>
      registrySlots(line).filter((slot) => slot.kind !== "standard")
    );
    expect(kindSlots.map((slot) => slot.kind).sort()).toEqual(["landmark", "shinheuh", "shinheuh"]);

    // A kind slot sits on exactly the one line its instance is for, so the
    // reveal match reads the same thing it reads on a position slot.
    for (const line of ["frontline", "backline"]) {
      for (const slot of registrySlots(line).filter((candidate) => candidate.kind !== "standard")) {
        expect(slot.lines).toEqual([line]);
      }
    }

    // A shinheuh's line is authored per card, so its slot offers the line the
    // player picked and the card's own `deployLines` decides the match.
    expect(registrySlots("frontline").find((slot) => slot.kind === "shinheuh")).toMatchObject({
      code: "shinheuh",
      kind: "shinheuh",
      lines: ["frontline"],
      name: "Shinheuh",
      iconPath: "/assets/icons/positions/frontline-shinheuh.png",
    });
    expect(registrySlots("backline").find((slot) => slot.kind === "shinheuh")).toMatchObject({
      code: "shinheuh",
      kind: "shinheuh",
      lines: ["backline"],
      name: "Shinheuh",
      iconPath: "/assets/icons/positions/backline-shinheuh.png",
    });

    // The Conduit is summoned onto the enemy backline by its attribute engine
    // and no shipped card puts one in a hand, so it earns no drop target.
    expect(kindSlots.some((slot) => slot.kind === "conduit")).toBe(false);
  });

  test("gives every kind slot the kind's own glossary description", () => {
    const glossary = getGlossaryView();
    // What a position slot's chip tooltip reads: the position entry's copy, as
    // compiled display segments rather than a raw string.
    const positionDescription = getPositions()[Object.keys(positionsSource)[0]].description;
    expect(Array.isArray(positionDescription.segments)).toBe(true);
    expect(positionDescription.segments.length).toBeGreaterThan(0);

    const slots = ["frontline", "backline"].flatMap(kindSlotsOn);
    expect(slots.length).toBeGreaterThan(0);

    for (const slot of slots) {
      const entry = glossary.kinds[slot.code];
      expect(entry).toBeDefined();
      // The same shape a position slot's description has, so the one chip
      // tooltip builder renders both without a second path.
      expect(Object.keys(slot.description).sort()).toEqual(
        Object.keys(positionDescription).sort()
      );
      expect(Array.isArray(slot.description.segments)).toBe(true);
      expect(slot.description.segments.length).toBeGreaterThan(0);
      expect(segmentsToPlainText(slot.description).trim()).not.toBe("");
      // The copy is that kind's glossary entry, projected for display.
      expect(slot.description).toEqual(entry.description);
      expect(segmentsToPlainText(slot.description)).toBe(glossarySource.kinds[slot.code].description);
      // No verbatim copy of a kind's prose is authored, so no italic tail.
      expect(slot.verboseDescription).toBeUndefined();
    }
  });

  test("places a shinheuh on the line its own card authors", () => {
    const shinheuhCards = Object.values(cards).filter((card) => card.kind === "shinheuh");
    expect(shinheuhCards.length).toBeGreaterThan(0);

    for (const card of shinheuhCards) {
      expect(card.line).toEqual(expect.any(String));
      expect(deployLinesFor({ kind: card.kind, line: card.line, name: card.name })).toEqual([
        card.line,
      ]);
    }
  });

  test("throws for a shinheuh the rule cannot place, as the engine does", () => {
    expect(() => deployLinesFor({ kind: "shinheuh", name: "Lineless" })).toThrow(/has no line/);
  });
});

describe("cards route", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    ({ server } = createGameServer({ loadRoom: async () => null, logToFile: false }));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
  });

  const compiledCount = Object.keys(cardsData).length;
  const compiledTestCount = Object.values(cardsData).filter(isTestCard).length;

  test("GET /cards/data serves every non-test card view", async () => {
    const response = await fetch(`${baseUrl}/cards/data`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cards).toHaveLength(compiledCount - compiledTestCount);
    expect(payload.cards.some((view) => isTestCard(view))).toBe(false);
    expect(payload.testCards).toBeUndefined();
    expect(payload.orphanArtworks).toBeUndefined();
    for (const view of payload.cards) {
      expect(typeof view.name).toBe("string");
      expect(typeof view.cardId).toBe("number");
    }
  });

  test("GET /cards/data marks deck eligibility from the engine's own rule", async () => {
    const eligible = new Set(GameState.getEligibleCardIds(cardsData));
    const payload = await (await fetch(`${baseUrl}/cards/data`)).json();

    for (const view of payload.cards) {
      expect({ cardId: view.cardId, deckEligible: view.deckEligible }).toEqual({
        cardId: view.cardId,
        deckEligible: eligible.has(view.cardId),
      });
    }
    expect(payload.cards.some((view) => view.deckEligible === false)).toBe(true);
  });

  test("GET /cards/data?dev=true adds test cards and orphan artworks", async () => {
    const response = await fetch(`${baseUrl}/cards/data?dev=true`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cards).toHaveLength(compiledCount - compiledTestCount);
    expect(payload.testCards).toHaveLength(compiledTestCount);
    for (const view of payload.testCards) expect(isTestCard(view)).toBe(true);

    const claimed = new Set(
      [...payload.cards, ...payload.testCards]
        .map((view) => view.artworkPath?.split("/").pop())
        .filter(Boolean)
    );
    const expectedOrphans = (await import("node:fs")).readdirSync("public/assets/images/artworks")
      .filter((name) => name.endsWith(".png"))
      .filter((name) => !claimed.has(name))
      .sort();
    expect(payload.orphanArtworks.map((orphan) => orphan.name)).toEqual(
      expectedOrphans.map((name) => name.replace(/\.png$/, ""))
    );
    for (const orphan of payload.orphanArtworks) {
      expect(orphan.artworkPath).toBe(`/assets/images/artworks/${orphan.name}.png`);
    }
  });

  test("dev only activates on the exact value true", async () => {
    const response = await fetch(`${baseUrl}/cards/data?dev=1`);
    const payload = await response.json();
    expect(payload.testCards).toBeUndefined();
  });

  test("GET /cards serves the page", async () => {
    const response = await fetch(`${baseUrl}/cards`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('src="/pages/cards/script.js"');
  });
});

describe("positions route", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    ({ server } = createGameServer({ loadRoom: async () => null, logToFile: false }));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
  });

  const fetchPositions = async () => {
    const response = await fetch(`${baseUrl}/positions/`);
    expect(response.status).toBe(200);
    return await response.json();
  };

  test("keeps one entry per position, in catalog order, with nothing else mixed in", async () => {
    const payload = await fetchPositions();
    expect(Object.keys(payload)).toEqual([...Object.keys(positionsSource), "placement"]);
  });

  test("ships the five position entries with their authored fields and no substitutions", async () => {
    const payload = await fetchPositions();

    for (const [code, position] of Object.entries(positionsSource)) {
      const entry = payload[code];
      expect(entry).toBeDefined();
      // The display name still reads as the authored name after the prose
      // projection, and every non-prose field survives untouched.
      expect(entry.name).toBe(position.name);
      expect(entry.line).toBe(position.line);
      expect(entry.special).toBe(position.special);
      expect(entry.combatSlotGroup).toBe(position.combatSlotGroup);
      expect(segmentsToPlainText(entry.description)).toBe(position.description);
      expect(segmentsToPlainText(entry.verboseDescription)).toBe(position.verboseDescription);
      // Prose stays display segments, which is what the tooltips render.
      expect(Array.isArray(entry.description.segments)).toBe(true);
      expect(Array.isArray(entry.verboseDescription.segments)).toBe(true);
    }
  });

  test("serves each position the icon the board paints for it", async () => {
    const payload = await fetchPositions();
    for (const code of Object.keys(positionsSource)) {
      expect(payload[code].iconPath).toBe(`/assets/icons/positions/${code}.png`);
    }
  });

  test("ships the placement registry in the same payload as the positions", async () => {
    const payload = await fetchPositions();

    expect(Object.keys(payload.placement)).toEqual(["frontline", "backline"]);
    for (const line of ["frontline", "backline"]) {
      expect(payload.placement[line]).toEqual(registrySlots(line));
    }

    // The board reads one fetch: the registry's position slots are the
    // positions the same payload just served.
    for (const line of ["frontline", "backline"]) {
      for (const slot of payload.placement[line].filter((entry) => entry.kind === "standard")) {
        expect({ code: slot.code, name: slot.name, iconPath: slot.iconPath }).toEqual({
          code: slot.code,
          name: payload[slot.code].name,
          iconPath: payload[slot.code].iconPath,
        });
      }
    }
  });

  test("serves every kind slot the copy its chip tooltip shows", async () => {
    const payload = await fetchPositions();
    const glossary = getGlossaryView();

    for (const line of ["frontline", "backline"]) {
      for (const slot of payload.placement[line].filter((entry) => entry.kind !== "standard")) {
        expect(slot.description).toEqual(glossary.kinds[slot.code].description);
        expect(slot.description.segments.length).toBeGreaterThan(0);
      }
    }

    // The chip the client builds from a kind slot: the slot plus the line it
    // sits on, which is how the tooltip builder labels it.
    const [landmark] = payload.placement.backline.filter((slot) => slot.kind === "landmark");
    const entries = buildPositionTooltipEntries({ ...landmark, line: "backline" }, glossary);
    expect(entries).toEqual([
      { text: glossary.lines.backline.label, style: "label" },
      { segments: glossary.kinds.landmark.description.segments },
    ]);
    expect(entries.some((entry) => entry.style === "italic")).toBe(false);
  });

  test("gives a landing card a line's slots to match against", async () => {
    const payload = await fetchPositions();

    const landmarkSlots = payload.placement.backline.filter((slot) => slot.kind === "landmark");
    expect(landmarkSlots).toHaveLength(1);
    expect(landmarkSlots[0]).toMatchObject({
      code: "landmark",
      lines: ["backline"],
      iconPath: "/assets/icons/positions/landmark.png",
    });
    expect(payload.placement.frontline.some((slot) => slot.kind === "landmark")).toBe(false);

    for (const line of ["frontline", "backline"]) {
      const slots = payload.placement[line];
      for (const slot of slots) {
        // Whatever shape a slot is, it accepts the one line it sits on.
        expect(slot.lines).toEqual([line]);
      }
      // A hand shinheuh lands on whichever line the player picked.
      expect(slots.filter((slot) => slot.kind === "shinheuh")).toHaveLength(1);
      expect(slots.some((slot) => slot.kind === "conduit")).toBe(false);
    }
  });
});
