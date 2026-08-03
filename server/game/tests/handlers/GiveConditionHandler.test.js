import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import GiveConditionHandler from "../../handlers/GiveConditionHandler.js";

describe("GiveConditionHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new GiveConditionHandler();
    gameState = { modifierStack: stack };
  });

  test("applies a condition to a target", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        condition: "poisoned",
        amount: 3,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(3);
    expect(stack.has("Unit#1", "condition", "poisoned")).toBe(true);
  });

  test("blocks condition application when target has Immune", () => {
    // Grant Immune to target first
    stack.apply({
      sourceId: "Card#1", sourceType: "unit",
      targetId: "Unit#1", type: "trait", key: "immune", value: 1,
    });

    const result = { blocked: null };
    bus.on("Test", (p, ctx) => {
      result.blocked = handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        condition: "poisoned",
        amount: 2,
      }, ctx, gameState).blocked;
    }, { phase: "execute" });

    bus.emit("Test");

    expect(result.blocked).toBe(true);
    expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(0);
  });

  test("emits child event on successful application", () => {
    const listener = jest.fn();
    bus.on("state:condition:applied", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        condition: "burned",
        amount: 1,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].condition).toBe("burned");
  });

  test("emits blocked event when immune", () => {
    stack.apply({
      sourceId: "Card#1", sourceType: "unit",
      targetId: "Unit#1", type: "trait", key: "immune", value: 1,
    });

    const listener = jest.fn();
    bus.on("state:condition:blocked", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Unit#Enemy",
        targetId: "Unit#1",
        condition: "rooted",
        amount: 1,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].reason).toBe("immune");
  });
});
