import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import { buildPlacementRegistry, deployLinesFor } from "../../placement.js";
import { cards, getCardIdByName, setupGameWithHands } from "../utils.js";

// A caller-resolved position catalog and kind glossary, in the shapes the
// display catalogs project: `code -> { line, name, iconPath }` and
// `code -> { name, iconPath }`. The registry copies these entries; it resolves
// nothing itself.
const POSITIONS = {
  fisherman: { code: "fisherman", name: "Fisherman", line: "frontline", iconPath: "/assets/icons/positions/fisherman.png" },
  scout: { code: "scout", name: "Scout", line: "frontline", iconPath: "/assets/icons/positions/scout.png" },
  "spear-bearer": { code: "spear-bearer", name: "Spear Bearer", line: "backline", iconPath: "/assets/icons/positions/spear-bearer.png" },
  "light-bearer": { code: "light-bearer", name: "Light Bearer", line: "backline", iconPath: "/assets/icons/positions/light-bearer.png" },
};

const KINDS = {
  standard: { name: "Unit", iconPath: "/assets/icons/positions/standard.png" },
  shinheuh: { name: "Shinheuh", iconPath: "/assets/icons/positions/shinheuh.png" },
  landmark: { name: "Landmark", iconPath: "/assets/icons/positions/landmark.png" },
  conduit: { name: "Conduit", iconPath: "/assets/icons/positions/conduit.png" },
};

const FRONT_LINE_POSITIONS = {
  fisherman: POSITIONS.fisherman,
  scout: POSITIONS.scout,
};

const BOTH_LINE_POSITIONS = {
  fisherman: POSITIONS.fisherman,
  "spear-bearer": POSITIONS["spear-bearer"],
};

const standard = (positions, extra = {}) => ({ kind: "standard", positions, ...extra });

const cardView = (name) =>
  new Card(getCardIdByName(name), cards[getCardIdByName(name)], "Alice", null).toSanitizedObject();

describe("deployLinesFor", () => {
  test("resolves a standard card through the chosen position's line", () => {
    const card = standard(BOTH_LINE_POSITIONS);

    expect(deployLinesFor(card, "fisherman", POSITIONS)).toEqual(["frontline"]);
    expect(deployLinesFor(card, "spear-bearer", POSITIONS)).toEqual(["backline"]);
    // Without a catalog the card's own printed positions carry the catalog lines.
    expect(deployLinesFor(card, "spear-bearer")).toEqual(["backline"]);
  });

  test("answers every line a standard card's printed positions resolve to", () => {
    expect(deployLinesFor(standard(FRONT_LINE_POSITIONS), null, POSITIONS)).toEqual(["frontline"]);
    expect(deployLinesFor(standard(BOTH_LINE_POSITIONS), null, POSITIONS)).toEqual([
      "frontline",
      "backline",
    ]);
  });

  test("resolves a shinheuh to the lines its own card names", () => {
    expect(deployLinesFor({ kind: "shinheuh", line: "backline" })).toEqual(["backline"]);
    expect(deployLinesFor({ kind: "shinheuh", line: "frontline" }, "backline", POSITIONS)).toEqual([
      "frontline",
    ]);
  });

  test("answers both lines for a card that names both, in authored order", () => {
    const twoLine = { kind: "shinheuh", line: ["backline", "frontline"] };

    expect(deployLinesFor(twoLine)).toEqual(["backline", "frontline"]);
    expect(deployLinesFor({ kind: "shinheuh", line: ["frontline", "backline"] })).toEqual([
      "frontline",
      "backline",
    ]);
  });

  test("refuses a shinheuh that names no line, with the engine's message", () => {
    const message = 'Shinheuh "Bull" has no line.';

    expect(() => deployLinesFor({ kind: "shinheuh", name: "Bull" })).toThrow(message);
    expect(() => deployLinesFor({ kind: "shinheuh", name: "Bull", line: null })).toThrow(message);
    expect(() => deployLinesFor({ kind: "shinheuh", name: "Bull", line: "" })).toThrow(message);
  });

  test("resolves a landmark and the conduit to the backline whatever position is given", () => {
    expect(deployLinesFor({ kind: "landmark" }, "fisherman", POSITIONS)).toEqual(["backline"]);
    expect(deployLinesFor({ kind: "conduit" }, "scout", POSITIONS)).toEqual(["backline"]);
    expect(deployLinesFor({ kind: "landmark", line: "frontline" })).toEqual(["backline"]);
  });

  test("refuses an unknown position code with the engine's message", () => {
    expect(() => deployLinesFor(standard(FRONT_LINE_POSITIONS), "not-a-position", POSITIONS)).toThrow(
      'Invalid position: "not-a-position"'
    );
  });

  test("resolves any line the catalog holds; the printed-position check is the caller's", () => {
    // A standard card may only be placed in a position it prints, but that check
    // belongs to the deploy path (and its own error message), not to the rule.
    expect(deployLinesFor(standard(FRONT_LINE_POSITIONS), "spear-bearer", POSITIONS)).toEqual(["backline"]);
  });

  test("de-duplicates lines and keeps first-occurrence order", () => {
    expect(deployLinesFor(standard({ scout: POSITIONS.scout, fisherman: POSITIONS.fisherman }))).toEqual(
      ["frontline"]
    );
    expect(
      deployLinesFor(
        standard({
          "spear-bearer": POSITIONS["spear-bearer"],
          fisherman: POSITIONS.fisherman,
          "light-bearer": POSITIONS["light-bearer"],
        })
      )
    ).toEqual(["backline", "frontline"]);
    expect(deployLinesFor({ kind: "shinheuh", line: ["frontline", "frontline", "backline"] })).toEqual([
      "frontline",
      "backline",
    ]);
  });

  test("refuses input that is not a card", () => {
    expect(() => deployLinesFor(null)).toThrow("deployLinesFor requires a card.");
    expect(() => deployLinesFor("Test Scout")).toThrow("deployLinesFor requires a card.");
  });
});

describe("buildPlacementRegistry", () => {
  test("lists each line's position slots before its kind slots", () => {
    const registry = buildPlacementRegistry(POSITIONS, { landmark: KINDS.landmark, shinheuh: KINDS.shinheuh });

    expect(Object.keys(registry)).toEqual(["frontline", "backline"]);
    expect(registry.frontline.map((slot) => slot.code)).toEqual(["fisherman", "scout", "shinheuh"]);
    expect(registry.backline.map((slot) => slot.code)).toEqual([
      "spear-bearer",
      "light-bearer",
      "landmark",
      "shinheuh",
    ]);
  });

  test("keeps the caller's catalog order among kind slots", () => {
    const registry = buildPlacementRegistry(POSITIONS, { shinheuh: KINDS.shinheuh, landmark: KINDS.landmark });

    expect(registry.backline.map((slot) => slot.code)).toEqual([
      "spear-bearer",
      "light-bearer",
      "shinheuh",
      "landmark",
    ]);
  });

  test("shapes a position slot as the standard kind on its own line", () => {
    const registry = buildPlacementRegistry(POSITIONS, KINDS);

    expect(registry.frontline[0]).toEqual({
      code: "fisherman",
      kind: "standard",
      lines: ["frontline"],
      name: "Fisherman",
      iconPath: "/assets/icons/positions/fisherman.png",
    });
    expect(registry.backline[0]).toEqual({
      code: "spear-bearer",
      kind: "standard",
      lines: ["backline"],
      name: "Spear Bearer",
      iconPath: "/assets/icons/positions/spear-bearer.png",
    });
  });

  test("shapes a kind slot on each line the kind may occupy, naming that one line", () => {
    const registry = buildPlacementRegistry(POSITIONS, KINDS);
    const shinheuhSlots = [...registry.frontline, ...registry.backline].filter(
      (slot) => slot.code === "shinheuh"
    );

    expect(shinheuhSlots).toEqual([
      {
        code: "shinheuh",
        kind: "shinheuh",
        lines: ["frontline"],
        name: "Shinheuh",
        iconPath: "/assets/icons/positions/shinheuh.png",
      },
      {
        code: "shinheuh",
        kind: "shinheuh",
        lines: ["backline"],
        name: "Shinheuh",
        iconPath: "/assets/icons/positions/shinheuh.png",
      },
    ]);
    expect(registry.backline.at(-1)).toEqual({
      code: "landmark",
      kind: "landmark",
      lines: ["backline"],
      name: "Landmark",
      iconPath: "/assets/icons/positions/landmark.png",
    });
  });

  test("gives no slot to a kind that cannot be deployed from hand", () => {
    const registry = buildPlacementRegistry(POSITIONS, KINDS);
    const codes = [...registry.frontline, ...registry.backline].map((slot) => slot.code);

    expect(codes).not.toContain("conduit");
    expect(codes).not.toContain("standard");
  });

  test("copies the caller's icons and falls back to the code for a name", () => {
    expect(buildPlacementRegistry({ scout: { line: "frontline" } }, {})).toEqual({
      frontline: [{ code: "scout", kind: "standard", lines: ["frontline"], name: "scout", iconPath: null }],
      backline: [],
    });
  });

  test("lists the canonical lines even with no catalogs, and drops an unlined position", () => {
    expect(buildPlacementRegistry()).toEqual({ frontline: [], backline: [] });
    expect(buildPlacementRegistry({ broken: { name: "Broken" } }, {})).toEqual({
      frontline: [],
      backline: [],
    });
  });
});

describe("Card deploy lines", () => {
  test("reports the distinct lines a standard card's printed positions resolve to", () => {
    const scout = cardView("Test Scout");
    expect(scout.deployLines).toEqual(["frontline"]);
    // `positions` stays what the card prints: two positions on one line.
    expect(Object.keys(scout.positions)).toEqual(["fisherman", "scout"]);

    const multi = cardView("Test Multi Position");
    expect(multi.deployLines).toEqual(["frontline", "backline"]);
    expect(Object.keys(multi.positions)).toEqual(["fisherman", "spear-bearer"]);
  });

  test("reports the authored line of a shinheuh and the backline of a landmark", () => {
    expect(cardView("Test Shinheuh").deployLines).toEqual(["frontline"]);
    expect(cardView("Test Shinheuh").positions).toEqual({});

    const landmark = cardView("Test Landmark Unit");
    expect(landmark.deployLines).toEqual(["backline"]);
    expect(landmark.positions).toEqual({});
  });

  test("refuses a card view for a shinheuh that names no line", () => {
    const lineLess = new Card(1, { type: "unit", kind: "shinheuh", name: "Line Thrower", cost: 1, hp: 3 }, "Alice", null);

    expect(() => lineLess.toSanitizedObject()).toThrow('Shinheuh "Line Thrower" has no line.');
  });
});

describe("LifecycleEngine deploy line delegation", () => {
  const game = setupGameWithHands({
    Alice: ["Test Scout", "Test Shinheuh", "Test Landmark Unit"],
  });
  const handCard = (name) => game.playerStates.Alice.hand.find((card) => card.name === name);
  // The Conduit carries the `unreachable` deck constraint, so it is never in a
  // deck: it is built as an instance, the way its attribute engine creates one.
  const conduitId = getCardIdByName("Test Conduit");
  const conduit = new Card(conduitId, cards[conduitId], "Alice", null);

  test("resolves a standard unit's line through the game's position catalog", () => {
    expect(LifecycleEngine._lineForCard(game, handCard("Test Scout"), "scout")).toBe("frontline");
    expect(LifecycleEngine._lineForCard(game, handCard("Test Scout"), "spear-bearer")).toBe("backline");
  });

  test("refuses an unknown position code with the engine's message", () => {
    expect(() => LifecycleEngine._lineForCard(game, handCard("Test Scout"), "not-a-position")).toThrow(
      'Invalid position: "not-a-position"'
    );
  });

  test("resolves special kinds by their card or kind, not their position code", () => {
    expect(LifecycleEngine._lineForCard(game, handCard("Test Shinheuh"), null)).toBe("frontline");
    expect(LifecycleEngine._lineForCard(game, handCard("Test Landmark Unit"), null)).toBe("backline");
    expect(LifecycleEngine._lineForCard(game, conduit, null)).toBe("backline");
  });
});
