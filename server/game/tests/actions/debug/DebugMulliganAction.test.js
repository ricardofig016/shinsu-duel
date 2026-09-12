import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction, getCardIdByName } from "../../utils.js";

const mulligan = (game, data) => game.processAction(debugAction("debug-mulligan-action", data));

describe("DebugMulliganAction", () => {
  test("shuffles the whole hand back and draws the requested count", () => {
    const game = createTestGame();
    const announced = [];
    game.eventBus.on(EVT.CARD_DRAWN, (payload) => announced.push(payload.cardName), { phase: "post" });
    const handBefore = game.playerStates.Alice.hand.map((card) => card.id);
    const deckBefore = game.playerStates.Alice.deck.length;

    mulligan(game, { username: "Alice", amount: handBefore.length });

    expect(game.playerStates.Alice.hand).toHaveLength(handBefore.length);
    expect(game.playerStates.Alice.deck).toHaveLength(deckBefore);
    expect(announced).toHaveLength(handBefore.length);
    // The hand is a fresh, disjoint set: one card instance lives in exactly
    // one zone, so nothing the player already held is both drawn and kept.
    const handIds = game.playerStates.Alice.hand.map((card) => card.id);
    expect(new Set(handIds).size).toBe(handIds.length);
  });

  test("draws fewer cards than the hand held when asked to", () => {
    const game = createTestGame();
    const handSize = game.playerStates.Alice.hand.length;

    mulligan(game, { username: "Alice", amount: handSize - 2 });

    expect(game.playerStates.Alice.hand).toHaveLength(handSize - 2);
  });

  test("an empty deck mid-mulligan keeps the engine's exhaustion loss", () => {
    const game = createTestGame();
    // The whole hand goes back before the draw, so the deck holds every card
    // the seat owns; asking for one more than that exhausts it.
    const owned = game.playerStates.Bob.deck.length + game.playerStates.Bob.hand.length;

    mulligan(game, { username: "Bob", amount: owned + 1 });

    expect(game.playerStates.Bob.deck).toHaveLength(0);
    expect(game.gameOver).toEqual({ winner: "Alice", reason: "deck exhausted" });
  });

  test("rejects a player source and a malformed amount", () => {
    const game = createTestGame();
    expect(() =>
      game.processAction({
        type: "debug-mulligan-action",
        data: { source: "player", requestedBy: "Bob", username: "Bob", amount: 5 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
    expect(() => mulligan(game, { username: "Bob", amount: 2.5 })).toThrow("amount must be an integer");
    expect(() => mulligan(game, { username: "Nobody", amount: 5 })).toThrow("Player Nobody not found.");
  });

  test("a mulligan never leaves a card in two zones", () => {
    const game = createTestGame();
    const scout = getCardIdByName("Test Scout");
    game.processAction(debugAction("debug-add-to-hand-action", { username: "Bob", cardId: scout }));

    mulligan(game, { username: "Bob", amount: 5 });

    const everywhere = [
      ...game.playerStates.Bob.hand,
      ...game.playerStates.Bob.deck,
      ...game.playerStates.Bob.discard,
    ].map((card) => card.id);
    expect(new Set(everywhere).size).toBe(everywhere.length);
  });
});
