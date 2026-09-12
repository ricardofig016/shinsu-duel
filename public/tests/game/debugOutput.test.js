import {
  DEBUG_COMMANDS,
  buildCardIndex,
  cardLabel,
  findCard,
  formatCardList,
  formatDebugEvent,
  formatHelp,
  formatUnitAbilities,
} from "../../game/debugOutput.js";

const VIEWS = [
  { cardId: 10001, name: "Test Scout", slug: "test-scout" },
  { cardId: 10002, name: "Test Novick", slug: "test-novick" },
];

const index = () => buildCardIndex(VIEWS);

describe("dev console card index", () => {
  test("finds a card by id, slug, or name", () => {
    const cards = index();
    expect(findCard(cards, 10001)).toBe(VIEWS[0]);
    expect(findCard(cards, "10001")).toBe(VIEWS[0]);
    expect(findCard(cards, "test-novick")).toBe(VIEWS[1]);
    expect(findCard(cards, "Test Novick")).toBe(VIEWS[1]);
    expect(findCard(cards, "test novick")).toBe(VIEWS[1]);
    expect(findCard(cards, "Missing")).toBeNull();
    expect(findCard(cards, null)).toBeNull();
    expect(findCard(cards, "1e3")).toBeNull();
  });

  test("skips malformed entries and labels nameless cards by id", () => {
    const cards = buildCardIndex([null, {}, { cardId: 5 }]);
    expect(findCard(cards, 5)).toEqual({ cardId: 5 });
    expect(cardLabel(cards, 5)).toBe("#5 (unknown card)");
    expect(cardLabel(index(), 10001)).toBe("Test Scout (#10001)");
    expect(cardLabel(index(), 999)).toBe("#999 (unknown card)");
  });
});

describe("dev console line formatting", () => {
  test("an engine event line carries its sequence, name, and fields", () => {
    expect(formatDebugEvent({ sequence: 4, name: "unit:deployed", fields: { username: "Alice", unitId: "u1" } })).toBe(
      "[event #4] unit:deployed username=Alice unitId=u1"
    );
    expect(formatDebugEvent({ sequence: 5, name: "turn:started", fields: {} })).toBe("[event #5] turn:started");
    expect(formatDebugEvent({ sequence: 6, name: "game:started", fields: { players: ["Alice", "Bob"] } })).toBe(
      "[event #6] game:started players=Alice|Bob"
    );
    expect(formatDebugEvent(undefined)).toBe("[event #?] ?");
  });

  test("a hand listing names every card", () => {
    const text = formatCardList(
      "hand",
      { username: "Alice", cards: [{ cardId: 10001, instanceId: "Card#10001#1" }] },
      index()
    );
    expect(text).toBe("Alice's hand (1)\n  0: Test Scout (#10001) instance Card#10001#1");
  });

  test("a deck listing marks the next card drawn", () => {
    const text = formatCardList(
      "deck",
      {
        username: "Bob",
        cards: [
          { cardId: 10002, instanceId: "Card#10002#2" },
          { cardId: 999, instanceId: "Card#999#3" },
        ],
      },
      index()
    );
    expect(text.split("\n")).toEqual([
      "Bob's deck (2)",
      "  0 (top): Test Novick (#10002) instance Card#10002#2",
      "  1: #999 (unknown card) instance Card#999#3",
    ]);
  });

  test("a unit's abilities list their codes and provenance", () => {
    const text = formatUnitAbilities({
      unitId: "unit-1",
      name: "Test Scout",
      owner: "Alice",
      native: [{ abilityCode: "0", ability: { raw: "scout: quick: peek" } }],
      granted: [{ abilityCode: "granted:Equip#1:heal", ability: { type: "heal" }, sourceId: "Equip#1" }],
    });
    expect(text.split("\n")).toEqual([
      "Test Scout (unit-1) owned by Alice",
      "printed:",
      "  0: scout: quick: peek",
      "granted:",
      "  granted:Equip#1:heal: heal (from Equip#1)",
    ]);

    const empty = formatUnitAbilities({ unitId: "unit-2", native: [], granted: [] });
    expect(empty).toContain("  none");
  });

  test("the help text lists every command", () => {
    const text = formatHelp();
    for (const [signature] of DEBUG_COMMANDS) expect(text).toContain(signature);
    expect(text).toContain("TESTROOM rooms only");
    expect(text).toContain("default to your own seat");
    expect(formatHelp([["debug.x()", "does x"]])).toContain("debug.x()");
  });
});
