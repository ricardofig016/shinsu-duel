import { createTestGame, debugAction } from "../../utils.js";

const shuffleDeck = (game, username) =>
  game.processAction(debugAction("debug-shuffle-deck-action", { username }));

describe("DebugShuffleDeckAction", () => {
  test("reorders the deck without changing its contents", () => {
    const game = createTestGame();
    const before = game.playerStates.Alice.deck.map((card) => card.id);

    shuffleDeck(game, "Alice");

    const after = game.playerStates.Alice.deck.map((card) => card.id);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after).not.toEqual(before);
  });

  test("is deterministic for a fixed seed", () => {
    const first = createTestGame();
    const second = createTestGame();

    shuffleDeck(first, "Bob");
    shuffleDeck(second, "Bob");

    // Card instance ids are global and differ between games; the order of
    // card definitions is what a seeded shuffle must reproduce.
    expect(first.playerStates.Bob.deck.map((card) => card.cardId)).toEqual(
      second.playerStates.Bob.deck.map((card) => card.cardId)
    );
  });

  test("rejects an unknown seat and a player source", () => {
    const game = createTestGame();
    expect(() => shuffleDeck(game, "Mallory")).toThrow("Player Mallory not found.");
    expect(() =>
      game.processAction({
        type: "debug-shuffle-deck-action",
        data: { source: "player", requestedBy: "Bob", username: "Alice" },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
