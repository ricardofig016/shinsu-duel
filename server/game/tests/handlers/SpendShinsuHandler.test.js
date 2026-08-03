import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import SpendShinsuHandler from "../../handlers/SpendShinsuHandler.js";

describe("SpendShinsuHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new SpendShinsuHandler();
    gameState = {
      modifierStack: stack,
      playerStates: {
        Alice: {
          shinsu: { normalAvailable: 5, normalSpent: 2, recharged: 2 },
        },
      },
    };
  });

  test("deducts from recharged shinsu first, then normal", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    const shinsu = gameState.playerStates.Alice.shinsu;
    expect(shinsu.recharged).toBe(0);  // 2 - 2 = 0 (all recharged spent)
    expect(shinsu.normalAvailable).toBe(4); // 5 - 1 = 4
    expect(shinsu.normalSpent).toBe(3); // 2 + 1
  });

  test("spends only from normal when recharged is 0", () => {
    gameState.playerStates.Alice.shinsu.recharged = 0;

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    const shinsu = gameState.playerStates.Alice.shinsu;
    expect(shinsu.recharged).toBe(0);
    expect(shinsu.normalAvailable).toBe(2);
    expect(shinsu.normalSpent).toBe(5);
  });

  test("emits state:shinsu:changed child event", () => {
    const listener = jest.fn();
    bus.on("state:shinsu:changed", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ owner: "Alice", amount: 1 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].spent).toBe(1);
  });

  test("throws when insufficient shinsu", () => {
    bus.on("Test", (p, ctx) => {
      expect(() => handler.execute({ owner: "Alice", amount: 99 }, ctx, gameState))
        .toThrow("insufficient shinsu");
    }, { phase: "execute" });

    bus.emit("Test");
  });

  test("throws for unknown player", () => {
    bus.on("Test", (p, ctx) => {
      expect(() => handler.execute({ owner: "Ghost", amount: 1 }, ctx, gameState))
        .toThrow("not found");
    }, { phase: "execute" });

    bus.emit("Test");
  });
});
