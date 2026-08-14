import { jest } from "@jest/globals";
import ChargeShinsuHandler from "../../handlers/ChargeShinsuHandler.js";
import EVT from "../../EventCatalog.js";
import { createTestGame } from "../utils.js";

describe("ChargeShinsuHandler", () => {
  let game, handler;

  beforeEach(() => {
    game = createTestGame();
    handler = new ChargeShinsuHandler();
  });

  function context() {
    return { emitChild: jest.fn() };
  }

  test("adds shinsu to the normal pool and emits shinsu:charged", () => {
    const player = game.playerStates[game.usernames[0]];
    game.round = 5;
    player.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 1 };
    const ctx = context();

    const result = handler.execute({ owner: game.usernames[0], amount: 2 }, ctx, game);

    expect(result.gained).toBe(2);
    expect(player.shinsu.normalAvailable).toBe(4);
    expect(player.shinsu.recharged).toBe(1); // untouched
    expect(ctx.emitChild).toHaveBeenCalledWith(EVT.SHINSU_CHARGED, {
      owner: game.usernames[0],
      amount: 2,
      total: 5,
    });
  });

  test("caps gained shinsu at the round maximum", () => {
    const player = game.playerStates[game.usernames[0]];
    game.round = 3;
    player.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 0 };
    const ctx = context();

    const result = handler.execute({ owner: game.usernames[0], amount: 10 }, ctx, game);

    expect(result.gained).toBe(1); // capped at round 3
    expect(player.shinsu.normalAvailable).toBe(3);
  });

  test("does not add to the recharged pool", () => {
    const player = game.playerStates[game.usernames[0]];
    game.round = 4;
    player.shinsu = { normalSpent: 0, normalAvailable: 1, recharged: 2 };
    handler.execute({ owner: game.usernames[0], amount: 1 }, context(), game);

    expect(player.shinsu.recharged).toBe(2);
    expect(player.shinsu.normalAvailable).toBe(2);
  });

  test("validate requires owner", () => {
    expect(() => handler.validate({ amount: 1 })).toThrow("payload.owner is required");
  });

  test("validate requires a positive integer amount", () => {
    expect(() => handler.validate({ owner: "Alice", amount: 0 })).toThrow("positive integer");
    expect(() => handler.validate({ owner: "Alice", amount: 1.5 })).toThrow("positive integer");
  });

  test("execute throws for unknown owner", () => {
    expect(() => handler.execute({ owner: "Nobody", amount: 1 }, context(), game)).toThrow('Player "Nobody" not found');
  });
});
