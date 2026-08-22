import { jest } from "@jest/globals";
import { setupGameWithCardsInHand, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";
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

  test("random mode with amount reveals that many cards", () => {
    const game = setupGameWithCardsInHand(["Baang"]);
    const result = handler.execute(
      { owner: "Bob", sourceOwner: "Alice", amount: 2 },
      context(),
      game
    );

    expect(result.revealed).toHaveLength(2);
  });

  test("mode choose defers to a card_selection decision", () => {
    const game = setupGameWithCardsInHand(["Baang"]);
    const result = handler.execute(
      { owner: "Bob", sourceOwner: "Alice", mode: "choose", amount: 1 },
      context(),
      game
    );

    expect(result.pending).toBe(true);
    expect(game.pendingDecision.type).toBe("card_selection");
  });

  test("card filter narrows the revealed cards", () => {
    const game = setupGameWithCardsInHand(["Baang"]);
    const baang = new Card(getCardIdByName("Baang"), game.constructor.cards[getCardIdByName("Baang")], "Bob", game.eventBus);
    const bull = new Card(getCardIdByName("Bull"), game.constructor.cards[getCardIdByName("Bull")], "Bob", game.eventBus);
    game.playerStates.Bob.hand = [baang, bull];

    const result = handler.execute(
      { owner: "Bob", sourceOwner: "Alice", mode: "all", card: { name: "Baang" } },
      context(),
      game
    );

    expect(result.revealed).toHaveLength(1);
    expect(result.revealed[0].name).toBe("Baang");
  });

  test("random peek is deterministic for the same seed", () => {
    const run = () => {
      const game = setupGameWithCardsInHand(["Baang"]);
      const result = handler.execute(
        { owner: "Bob", sourceOwner: "Alice", amount: 1 },
        context(),
        game
      );
      return result.revealed.map((c) => c.name);
    };

    expect(run()).toEqual(run());
  });

  test("validate throws without owner", () => {
    expect(() => handler.validate({})).toThrow("owner");
  });
});
