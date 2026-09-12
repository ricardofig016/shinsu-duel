import { createTestGame, debugAction, getCardIdByName } from "../../utils.js";

const addToDeck = (game, data) => game.processAction(debugAction("debug-add-to-deck-action", data));

describe("DebugAddToDeckAction", () => {
  test("puts a card on top of the deck, where it is drawn next", () => {
    const game = createTestGame();
    const scout = getCardIdByName("Test Scout");

    addToDeck(game, { username: "Alice", cardId: scout, placement: "top" });
    expect(game.playerStates.Alice.deck.at(-1).cardId).toBe(scout);

    game.processAction(debugAction("debug-draw-action", { username: "Alice", amount: 1 }));
    expect(game.playerStates.Alice.hand.at(-1).cardId).toBe(scout);
  });

  test("puts a card at the bottom of the deck", () => {
    const game = createTestGame();
    const scout = getCardIdByName("Test Scout");

    addToDeck(game, { username: "Alice", cardId: scout, placement: "bottom" });
    expect(game.playerStates.Alice.deck[0].cardId).toBe(scout);
  });

  test("rejects an unknown placement, an unknown card, and a player source", () => {
    const game = createTestGame();
    expect(() => addToDeck(game, { username: "Alice", cardId: 1, placement: "middle" })).toThrow(
      'placement must be "top" or "bottom".'
    );
    expect(() => addToDeck(game, { username: "Alice", cardId: 999999, placement: "top" })).toThrow(
      "Card 999999 does not exist."
    );
    expect(() =>
      game.processAction({
        type: "debug-add-to-deck-action",
        data: { source: "player", requestedBy: "Bob", username: "Alice", cardId: 1, placement: "top" },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
