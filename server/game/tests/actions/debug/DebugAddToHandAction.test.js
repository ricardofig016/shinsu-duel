import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction, getCardIdByName } from "../../utils.js";

const addToHand = (game, data) => game.processAction(debugAction("debug-add-to-hand-action", data));

describe("DebugAddToHandAction", () => {
  test("creates a catalog card in the target seat's hand", () => {
    const game = createTestGame();
    const created = [];
    game.eventBus.on(EVT.CARD_CREATED, (payload) => created.push(payload), { phase: "post" });
    const handBefore = game.playerStates.Bob.hand.length;
    const scout = getCardIdByName("Test Scout");

    addToHand(game, { username: "Bob", cardId: scout });

    const card = game.playerStates.Bob.hand.at(-1);
    expect(game.playerStates.Bob.hand).toHaveLength(handBefore + 1);
    expect(card.cardId).toBe(scout);
    expect(card.name).toBe("Test Scout");
    expect(card.owner).toBe("Bob");
    expect(created).toEqual([{ owner: "Bob", cardId: scout, name: "Test Scout" }]);
  });

  test("every copy is its own card instance", () => {
    const game = createTestGame();
    const scout = getCardIdByName("Test Scout");

    addToHand(game, { username: "Alice", cardId: scout });
    addToHand(game, { username: "Alice", cardId: scout });

    const [first, second] = game.playerStates.Alice.hand.slice(-2);
    expect(first.id).not.toBe(second.id);
  });

  test("rejects an unknown card id and a player source", () => {
    const game = createTestGame();
    expect(() => addToHand(game, { username: "Alice", cardId: 999999 })).toThrow(
      "Card 999999 does not exist."
    );
    expect(() =>
      game.processAction({
        type: "debug-add-to-hand-action",
        data: { source: "player", requestedBy: "Bob", username: "Alice", cardId: 1 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
