import { DECK_TABLE_COLUMNS } from "../../../../utils/deck-model.js";
import {
  SELECTION_COLUMNS,
  buildDeckStepView,
  buildOpponentLine,
  buildSelectionRows,
  buildVersusView,
  pickCleared,
} from "../../../../pages/game/deck/view-model.js";

const entriesBySlug = new Map([
  ["cheap_unit", { slug: "cheap_unit", name: "Cheap Unit", view: { type: "unit", cost: 1 } }],
  ["dear_unit", { slug: "dear_unit", name: "Dear Unit", view: { type: "unit", cost: 9 } }],
  ["a_skill", { slug: "a_skill", name: "A Skill", view: { type: "skill", cost: 4 } }],
]);

const legalDeck = { id: "d1", name: "Wave Control", cards: ["cheap_unit", "dear_unit", "a_skill"], legal: true, buildable: true, problems: [] };
const illegalDeck = { id: "d2", name: "Too Small", cards: ["cheap_unit"], legal: false, buildable: true, problems: ["A deck must contain exactly 30 cards; this one has 1."] };
const unbuildableDeck = { id: "d3", name: "Ghost Cards", cards: ["gone"], legal: false, buildable: false, problems: ['Card "gone" does not exist.'] };

const seat = (overrides = {}) => ({ username: "Alice", deckChosen: false, connected: true, deckId: null, deckName: null, illegal: false, ...overrides });

describe("selection columns", () => {
  test("the step shows the list's columns without the collection-only ones", () => {
    expect(SELECTION_COLUMNS.map((column) => column.key)).toEqual([
      "fan",
      "name",
      "size",
      "composition",
      "averageCost",
      "status",
    ]);
    for (const column of SELECTION_COLUMNS) {
      expect(DECK_TABLE_COLUMNS).toContainEqual(column);
    }
  });
});

describe("buildSelectionRows", () => {
  test("a legal deck is selectable and carries the deck-list row", () => {
    const [row] = buildSelectionRows([legalDeck], { entriesBySlug });
    expect(row.id).toBe("d1");
    expect(row.name).toBe("Wave Control");
    expect(row.cardCount).toBe(3);
    expect(row.averageCostLabel).toBe("4.7");
    expect(row.fan.map((entry) => entry.slug)).toEqual(["cheap_unit", "dear_unit"]);
    expect(row.selectable).toBe(true);
  });

  test("an illegal deck is not selectable in a normal room and is in a dev room", () => {
    expect(buildSelectionRows([illegalDeck], { entriesBySlug })[0].selectable).toBe(false);
    expect(buildSelectionRows([illegalDeck], { entriesBySlug, dev: true })[0].selectable).toBe(true);
  });

  test("a deck the engine cannot build is never selectable, not even in a dev room", () => {
    expect(buildSelectionRows([unbuildableDeck], { entriesBySlug, dev: true })[0].selectable).toBe(false);
  });

  test("no decks is an empty list", () => {
    expect(buildSelectionRows(undefined, {})).toEqual([]);
    expect(buildSelectionRows([], {})).toEqual([]);
  });
});

describe("buildOpponentLine", () => {
  test("reports presence and readiness, and never a deck", () => {
    expect(buildOpponentLine(null)).toBe("Waiting for the opponent to connect.");
    expect(buildOpponentLine(seat({ connected: false }))).toBe("Opponent is not connected.");
    expect(buildOpponentLine(seat())).toBe("Opponent is still choosing.");
    expect(buildOpponentLine(seat({ deckChosen: true }))).toBe("Opponent is ready.");
  });

  test("names a bot seat as ready whatever its pick state is", () => {
    expect(buildOpponentLine(seat({ bot: true, username: "[BOT] Whatever" }))).toBe("[BOT] Whatever is ready.");
    expect(buildOpponentLine(seat({ bot: true, username: "[BOT] Drunk", deckChosen: true }))).toBe("[BOT] Drunk is ready.");
  });

  test("a deck name on the seat object never reaches the line", () => {
    const line = buildOpponentLine(seat({ deckChosen: true, deckName: "Secret Tech" }));
    expect(line).not.toContain("Secret Tech");
  });
});

describe("buildDeckStepView", () => {
  const status = {
    dev: false,
    seats: [
      seat({ username: "Alice", deckChosen: true, deckId: "d1", deckName: "Wave Control" }),
      seat({ username: "Bob" }),
    ],
  };

  test("splits the seats by username and reads the locked deck from my own seat", () => {
    const view = buildDeckStepView({ status, decks: [legalDeck], username: "Alice", entriesBySlug });
    expect(view.mySeat.username).toBe("Alice");
    expect(view.opponentSeat.username).toBe("Bob");
    expect(view.lockedDeckId).toBe("d1");
    expect(view.opponentLine).toBe("Opponent is still choosing.");
    expect(view.rows).toHaveLength(1);
  });

  test("another seat's pick never becomes my locked deck", () => {
    const view = buildDeckStepView({
      status: { dev: false, seats: [seat({ username: "Alice" }), seat({ username: "Bob", deckChosen: true })] },
      decks: [],
      username: "Alice",
    });
    expect(view.lockedDeckId).toBeNull();
    expect(view.opponentLine).toBe("Opponent is ready.");
  });

  test("there is no view without a status", () => {
    expect(buildDeckStepView({ status: null, decks: [], username: "Alice" })).toBeNull();
  });
});

describe("pickCleared", () => {
  const withPick = { seats: [seat({ deckChosen: true, deckId: "d1", deckName: "Wave Control" })] };
  const withoutPick = { seats: [seat()] };

  test("a status that drops my own pick means the list is stale", () => {
    expect(pickCleared(withPick, withoutPick, "Alice")).toBe(true);
  });

  test("a pick that stays, a first status, and a seat that vanished are not reloads", () => {
    expect(pickCleared(withPick, withPick, "Alice")).toBe(false);
    expect(pickCleared(null, withoutPick, "Alice")).toBe(false);
    expect(pickCleared(withPick, { seats: [] }, "Alice")).toBe(false);
    expect(pickCleared(withPick, withoutPick, null)).toBe(false);
  });
});

describe("buildVersusView", () => {
  test("maps the revealed fan slugs through the loaded catalog", () => {
    const view = buildVersusView(
      { seats: [{ username: "Alice", deckName: "Wave Control", fan: ["dear_unit", "unknown_slug", "cheap_unit"] }] },
      entriesBySlug
    );
    expect(view.seats).toHaveLength(1);
    expect(view.seats[0].deckName).toBe("Wave Control");
    expect(view.seats[0].fan.map((entry) => entry.slug)).toEqual(["dear_unit", "cheap_unit"]);
  });

  test("no reveal, no seats", () => {
    expect(buildVersusView(null, entriesBySlug)).toEqual({ seats: [] });
    expect(buildVersusView({}, entriesBySlug)).toEqual({ seats: [] });
  });
});
