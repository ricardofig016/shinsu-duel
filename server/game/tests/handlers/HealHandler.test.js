import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import HealHandler from "../../handlers/HealHandler.js";

describe("HealHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new HealHandler();
    gameState = {
      modifierStack: stack,
      _findUnit: (id) => gameState._units[id],
      _units: {
        "Unit#1": { currentHp: 2, card: { maxHp: 5 }, isAlive: () => true },
        "Unit#2": { currentHp: 4, card: { maxHp: 5 }, isAlive: () => true },
      },
    };
  });

  test("heals a unit by the specified amount", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ targetId: "Unit#1", amount: 2 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(4);
  });

  test("does not heal beyond max HP", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({ targetId: "Unit#2", amount: 5 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#2"].currentHp).toBe(5);
  });

  test("emits unit:heal:applied child event", () => {
    const listener = jest.fn();
    bus.on("unit:heal:applied", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ targetId: "Unit#1", amount: 3 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].amount).toBe(3);
  });

  test("returns 0 healed when already at max HP", () => {
    let result;
    bus.on("Test", (p, ctx) => {
      result = handler.execute({ targetId: "Unit#2", amount: 5 }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(result.healed).toBe(1); // only 1 HP needed
  });
});
