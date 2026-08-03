import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import CreateLighthouseHandler from "../../handlers/CreateLighthouseHandler.js";

describe("CreateLighthouseHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new CreateLighthouseHandler();
    gameState = {
      modifierStack: stack,
      playerStates: {
        Alice: { lighthouses: { amount: 20 } },
        Bob: { lighthouses: { amount: 15 } },
      },
    };
  });

  test("creates lighthouses for a player", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Alice.lighthouses.amount).toBe(23);
  });

  test("caps lighthouses at 40", () => {
    gameState.playerStates.Alice.lighthouses.amount = 39;

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 5 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState.playerStates.Alice.lighthouses.amount).toBe(40);
  });

  test("emits state:lighthouse:changed child event", () => {
    const listener = jest.fn();
    bus.on("state:lighthouse:changed", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Bob", amount: 2 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].delta).toBe(2);
  });

  test("throws for unknown player", () => {
    bus.on("Test", (p, ctx) => {
      expect(() => handler.execute({ owner: "Ghost", amount: 1 }, ctx, gameState))
        .toThrow("not found");
    }, { phase: "execute" });

    bus.emit("Test");
  });
});
