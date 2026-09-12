import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction } from "../../utils.js";

const draw = (game, data) => game.processAction(debugAction("debug-draw-action", data));

describe("DebugDrawAction", () => {
  test("draws from the target seat's deck and announces each card", () => {
    const game = createTestGame();
    const drawn = [];
    game.eventBus.on(EVT.CARD_DRAWN, (payload) => drawn.push(payload), { phase: "post" });
    const handBefore = game.playerStates.Bob.hand.length;
    const deckBefore = game.playerStates.Bob.deck.length;

    draw(game, { username: "Bob", amount: 2 });

    expect(game.playerStates.Bob.hand.length).toBe(handBefore + 2);
    expect(game.playerStates.Bob.deck.length).toBe(deckBefore - 2);
    expect(drawn).toHaveLength(2);
    expect(drawn.map((payload) => payload.owner)).toEqual(["Bob", "Bob"]);
    // Every announcement reports the hand as it stands once the draw finished,
    // matching the engine's own draw announcements.
    expect(drawn.map((payload) => payload.handSize)).toEqual([handBefore + 2, handBefore + 2]);
    expect(drawn[0].cardName).toBe(game.playerStates.Bob.hand[handBefore].name);
  });

  test("drawing an empty deck keeps the engine's exhaustion loss", () => {
    const game = createTestGame();
    const deckSize = game.playerStates.Alice.deck.length;
    const over = [];
    game.eventBus.on(EVT.GAME_OVER, (payload) => over.push(payload), { phase: "post" });

    draw(game, { username: "Alice", amount: deckSize + 1 });

    expect(game.playerStates.Alice.deck).toHaveLength(0);
    expect(over).toHaveLength(1);
    expect(game.gameOver).toEqual({ winner: "Bob", reason: "deck exhausted" });
  });

  test("rejects a player source", () => {
    const game = createTestGame();
    expect(() =>
      game.processAction({
        type: "debug-draw-action",
        data: { source: "player", requestedBy: "Bob", username: "Bob", amount: 1 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });

  test("rejects an unknown seat, a negative amount, and a malformed payload", () => {
    const game = createTestGame();
    expect(() => draw(game, { username: "Mallory", amount: 1 })).toThrow("Player Mallory not found.");
    expect(() => draw(game, { username: "Bob", amount: -1 })).toThrow("amount must be an integer");
    expect(() => draw(game, { username: "Bob", amount: 1.5 })).toThrow("amount must be an integer");
    expect(() => draw(game, { username: "Bob", amount: "2" })).toThrow("Invalid type for field: amount");
  });

  test("rejects a debug action once the game is over", () => {
    const game = createTestGame();
    game.gameOver = { winner: "Alice", reason: "lighthouses depleted" };

    expect(() => draw(game, { username: "Bob", amount: 1 })).toThrow("The game is over.");
  });

  test("rejects a debug action while a decision is pending", () => {
    const game = createTestGame();
    game.createPendingDecision({
      owner: "Alice",
      type: "line_overflow",
      candidates: [{ id: "unit-1", name: "Test Scout", hp: 2 }],
      resolve: () => {},
    });

    expect(() => draw(game, { username: "Alice", amount: 1 })).toThrow(
      "A player decision must be resolved before another action."
    );
  });
});
