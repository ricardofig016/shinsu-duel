import { buildDeckOptions, findSeat, buildDeckStepViewModel } from "../../pages/game/deckStep.js";

const deck = (over = {}) => ({
  id: "deck-1",
  name: "My deck",
  cards: Array.from({ length: 30 }, () => "slug"),
  legal: true,
  problems: [],
  ...over,
});

describe("buildDeckOptions", () => {
  test("legal decks are selectable everywhere", () => {
    expect(buildDeckOptions([deck()], { dev: false })).toEqual([
      { id: "deck-1", name: "My deck", size: 30, legal: true, problems: [], selectable: true, warning: false },
    ]);
  });

  test("illegal decks are locked in a normal room and warned in a dev room", () => {
    const illegal = deck({ legal: false, problems: ['"Test Scout" is Unreachable and cannot be in a deck.'] });

    const normal = buildDeckOptions([illegal], { dev: false })[0];
    expect(normal.selectable).toBe(false);
    expect(normal.warning).toBe(false);
    expect(normal.problems).toEqual(['"Test Scout" is Unreachable and cannot be in a deck.']);

    const dev = buildDeckOptions([illegal], { dev: true })[0];
    expect(dev.selectable).toBe(true);
    expect(dev.warning).toBe(true);
  });

  test("handles a missing deck list and a missing cards array", () => {
    expect(buildDeckOptions(null, {})).toEqual([]);
    const option = buildDeckOptions([{ id: "deck-2", name: "Broken", legal: true }])[0];
    expect(option.size).toBe(0);
  });
});

describe("findSeat", () => {
  const status = {
    dev: false,
    seats: [
      { username: "Alice", deckChosen: true, deckId: "deck-1", deckName: "A", illegal: false },
      { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
    ],
  };

  test("finds a seat by username and returns null otherwise", () => {
    expect(findSeat(status, "Alice")).toEqual(status.seats[0]);
    expect(findSeat(status, "Mallory")).toBeNull();
    expect(findSeat(null, "Alice")).toBeNull();
  });
});

describe("buildDeckStepViewModel", () => {
  const status = {
    dev: true,
    seats: [
      { username: "Alice", deckChosen: true, deckId: "deck-1", deckName: "Illegal deck", illegal: true },
      { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
    ],
  };

  test("shapes the seat progress and the picker options", () => {
    const model = buildDeckStepViewModel({ status, decks: [deck()], username: "Alice" });

    expect(model.dev).toBe(true);
    expect(model.mySeat).toEqual(status.seats[0]);
    expect(model.myDeckId).toBe("deck-1");
    expect(model.opponentSeat).toEqual(status.seats[1]);
    expect(model.everySeatChosen).toBe(false);
    expect(model.options).toHaveLength(1);
  });

  test("myDeckId is null while the seat has no pick", () => {
    const model = buildDeckStepViewModel({ status, decks: [], username: "Bob" });
    expect(model.myDeckId).toBeNull();
  });

  test("reports everySeatChosen only when both seats picked", () => {
    const full = {
      dev: false,
      seats: [
        { username: "Alice", deckChosen: true, deckId: "deck-1", deckName: "A", illegal: false },
        { username: "Bob", deckChosen: true, deckId: "deck-2", deckName: "B", illegal: false },
      ],
    };
    expect(buildDeckStepViewModel({ status: full, decks: [], username: "Alice" }).everySeatChosen).toBe(true);
  });

  test("returns null without a status", () => {
    expect(buildDeckStepViewModel({ status: null, decks: [], username: "Alice" })).toBeNull();
  });
});
