import { jest } from "@jest/globals";
import { setupGameWithCardsInHand } from "../utils.js";
import PeekHandHandler from "../../handlers/PeekHandHandler.js";
import EVT from "../../EventCatalog.js";

describe("PeekHandHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new PeekHandHandler();
  });

  function context() {
    return { emitChild: jest.fn() };
  }

  test("reveals a random card (observer-only, no mutation)", () => {
    const game = setupGameWithCardsInHand(["Baang", "Baang", "Baang"]);
    const ctx = context();
    const handSize = game.playerStates.Bob.hand.length;

    const result = handler.execute(
      { owner: "Bob", sourceOwner: "Alice" },
      ctx,
      game
    );

    expect(result.revealed).toHaveLength(1);
    expect(ctx.emitChild).toHaveBeenCalledWith(EVT.HAND_PEEKED, expect.objectContaining({
      owner: "Bob",
      observer: "Alice",
      cards: expect.any(Array),
    }));
    // Observer-only: the opponent's hand is unchanged.
    expect(game.playerStates.Bob.hand).toHaveLength(handSize);
  });

  test("reveals all matching cards with mode: all", () => {
    const game = setupGameWithCardsInHand(["Baang", "Baang", "Baang"]);
    const ctx = context();

    const result = handler.execute(
      { owner: "Bob", sourceOwner: "Alice", mode: "all" },
      ctx,
      game
    );

    expect(result.revealed).toHaveLength(game.playerStates.Bob.hand.length);
  });

  test("reveals no cards when the hand is empty", () => {
    const game = setupGameWithCardsInHand(["Baang"]);
    game.playerStates.Bob.hand = [];
    expect(handler.execute({ owner: "Bob", sourceOwner: "Alice" }, context(), game))
      .toEqual({ revealed: [] });
  });

  test("validate throws without owner", () => {
    expect(() => handler.validate({})).toThrow("owner");
  });
});
