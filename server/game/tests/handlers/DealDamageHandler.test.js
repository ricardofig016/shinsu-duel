import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import DealDamageHandler from "../../handlers/DealDamageHandler.js";

describe("DealDamageHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new DealDamageHandler();
    gameState = {
      modifierStack: stack,
      _barrierUsedThisRound: new Set(),
      _findUnit: (id) => gameState._units[id],
      _units: {
        "Unit#1": { currentHp: 5, card: { maxHp: 5 }, isAlive: () => gameState._units["Unit#1"].currentHp > 0 },
        "Unit#2": { currentHp: 2, card: { maxHp: 3 }, isAlive: () => gameState._units["Unit#2"].currentHp > 0 },
      },
    };
  });

  test("deals damage and reduces HP", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Attacker",
        targetId: "Unit#1",
        amount: 3,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(2);
  });

  test("Barrier negates first damage each round", () => {
    stack.apply({
      sourceId: "Card#1", sourceType: "unit",
      targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
    });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        amount: 5,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(5); // no damage taken
  });

  test("Barrier only works once per round", () => {
    stack.apply({
      sourceId: "Card#1", sourceType: "unit",
      targetId: "Unit#1", type: "trait", key: "barrier", value: 1,
    });

    const damagePayload = { sourceId: "Unit#Enemy", targetId: "Unit#1", amount: 2 };

    bus.on("Test", (p, ctx) => handler.execute(damagePayload, ctx, gameState), { phase: "execute" });

    bus.emit("Test"); // First hit — Barrier absorbs
    expect(gameState._units["Unit#1"].currentHp).toBe(5);

    bus.emit("Test"); // Second hit — no Barrier
    expect(gameState._units["Unit#1"].currentHp).toBe(3);
  });

  test("Resilient reduces incoming damage", () => {
    stack.apply({
      sourceId: "Card#1", sourceType: "unit",
      targetId: "Unit#1", type: "trait", key: "resilient", value: 2,
    });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        amount: 5,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(2); // 5 - 2 Resilient = 3 damage
  });

  test("Weak condition increases incoming damage", () => {
    stack.apply({
      sourceId: "Unit#Enemy", sourceType: "unit",
      targetId: "Unit#1", type: "condition", key: "weak", value: 2,
    });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        amount: 3,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(0); // 3 + 2 Weak = 5 damage, HP was 5
  });

  test("kill check: emits unit:killed and unit:destroyed when HP reaches 0", () => {
    const killedListener = jest.fn();
    const destroyedListener = jest.fn();
    bus.on("unit:killed", killedListener, { phase: "post" });
    bus.on("unit:destroyed", destroyedListener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#2", // has 2 HP
        amount: 5,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#2"].currentHp).toBe(0);
    expect(killedListener).toHaveBeenCalledTimes(1);
    expect(destroyedListener).toHaveBeenCalledTimes(1);
  });

  test("no kill event when damage doesn't kill", () => {
    const killedListener = jest.fn();
    bus.on("unit:killed", killedListener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1", // has 5 HP
        amount: 3,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(2);
    expect(killedListener).not.toHaveBeenCalled();
  });

  test("damage cannot reduce HP below 0", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        amount: 999,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(gameState._units["Unit#1"].currentHp).toBe(0);
  });
});
