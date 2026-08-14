import { jest } from "@jest/globals";
import ReclaimCardsHandler from "../../handlers/ReclaimCardsHandler.js";
import EVT from "../../EventCatalog.js";
import { createTestGame } from "../utils.js";

describe("ReclaimCardsHandler", () => {
  let game, handler;

  beforeEach(() => {
    game = createTestGame();
    handler = new ReclaimCardsHandler();
  });

  function context() {
    return { emitChild: jest.fn() };
  }

  test("moves cards from discard to hand and emits card:reclaimed per card", () => {
    const player = game.playerStates[game.usernames[0]];
    const cardA = { cardId: 1, name: "Card A" };
    const cardB = { cardId: 2, name: "Card B" };
    player.hand = [];
    player.discard = [cardA, cardB];
    const ctx = context();

    const result = handler.execute({ owner: game.usernames[0], amount: 2 }, ctx, game);

    expect(result.reclaimed).toBe(2);
    expect(result.cards).toEqual([cardB, cardA]); // top of discard first
    expect(player.hand).toEqual([cardB, cardA]);
    expect(player.discard).toEqual([]);
    expect(ctx.emitChild).toHaveBeenCalledTimes(2);
    expect(ctx.emitChild.mock.calls[0]).toEqual([EVT.CARD_RECLAIMED, {
      owner: game.usernames[0],
      cardId: 2,
      cardName: "Card B",
    }]);
  });

  test("stops early when discard is exhausted", () => {
    const player = game.playerStates[game.usernames[0]];
    player.hand = [];
    player.discard = [{ cardId: 3, name: "Card C" }];
    const ctx = context();

    const result = handler.execute({ owner: game.usernames[0], amount: 5 }, ctx, game);

    expect(result.reclaimed).toBe(1);
    expect(result.cards).toHaveLength(1);
    expect(player.hand).toHaveLength(1);
    expect(player.discard).toEqual([]);
    expect(ctx.emitChild).toHaveBeenCalledTimes(1);
  });

  test("returns zero reclaimed when discard is empty", () => {
    const player = game.playerStates[game.usernames[0]];
    player.hand = [];
    player.discard = [];
    const ctx = context();

    const result = handler.execute({ owner: game.usernames[0], amount: 2 }, ctx, game);

    expect(result.reclaimed).toBe(0);
    expect(result.cards).toEqual([]);
    expect(ctx.emitChild).not.toHaveBeenCalled();
  });

  test("validate requires owner", () => {
    expect(() => handler.validate({ amount: 1 })).toThrow("payload.owner is required");
  });

  test("validate requires a positive integer amount", () => {
    expect(() => handler.validate({ owner: "Alice", amount: 0 })).toThrow("positive integer");
    expect(() => handler.validate({ owner: "Alice", amount: -1 })).toThrow("positive integer");
    expect(() => handler.validate({ owner: "Alice", amount: "2" })).toThrow("positive integer");
  });

  test("execute throws for unknown owner", () => {
    const ctx = context();
    expect(() => handler.execute({ owner: "Nobody", amount: 1 }, ctx, game)).toThrow('Player "Nobody" not found');
  });
});
