import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import DestroyLighthouseHandler from "../../handlers/DestroyLighthouseHandler.js";

describe("DestroyLighthouseHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new DestroyLighthouseHandler();
    gameState = {
      modifierStack: stack,
      usernames: ["Alice", "Bob"],
      playerStates: {
        Alice: { lighthouses: { amount: 20 } },
        Bob:   { lighthouses: { amount: 5 } },
      },
    };
  });

  test("destroys lighthouses for a player", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Alice.lighthouses.amount).toBe(17);
  });

  test("floors lighthouses at 0", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Bob", amount: 99 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Bob.lighthouses.amount).toBe(0);
  });

  test("emits state:lighthouse:changed child event with negative delta", () => {
    const listener = jest.fn();
    bus.on("state:lighthouse:changed", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 2 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].delta).toBe(-2);
    expect(listener.mock.calls[0][0].oldAmount).toBe(20);
    expect(listener.mock.calls[0][0].newAmount).toBe(18);
  });

  test("emits game:lighthouses:depleted when lighthouses reach 0", () => {
    const listener = jest.fn();
    bus.on("game:lighthouses:depleted", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Bob", amount: 5 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].owner).toBe("Bob");
    expect(listener.mock.calls[0][0].opponent).toBe("Alice");
  });

  test("does NOT emit depleted when lighthouses stay above 0", () => {
    const listener = jest.fn();
    bus.on("game:lighthouses:depleted", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Bob", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    // Bob went from 5 → 2, not 0
    expect(listener).not.toHaveBeenCalled();
    expect(gameState.playerStates.Bob.lighthouses.amount).toBe(2);
  });

  test("returns correct result", () => {
    let result;
    bus.on("Test", (p, ctx) => {
      result = handler.execute({ owner: "Alice", amount: 4 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(result.destroyed).toBe(4);
    expect(result.current).toBe(16);
    expect(result.depleted).toBe(false);
  });

  test("throws for unknown player", () => {
    bus.on("Test", (p, ctx) => {
      expect(() => handler.execute({ owner: "Ghost", amount: 1 }, ctx, gameState))
        .toThrow("not found");
    }, { phase: "execute" });

    bus.emit("Test");
  });
});
