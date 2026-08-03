import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import CleanseHandler from "../../handlers/CleanseHandler.js";

describe("CleanseHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new CleanseHandler();
    gameState = { modifierStack: stack };
  });

  test("removes all conditions from target but preserves traits", () => {
    stack.apply({
      sourceId: "Card#1", sourceType: "unit",
      targetId: "Unit#1", type: "trait", key: "strong", value: 2,
    });
    stack.apply({
      sourceId: "Unit#Enemy", sourceType: "unit",
      targetId: "Unit#1", type: "condition", key: "poisoned", value: 4,
    });
    stack.apply({
      sourceId: "Unit#Enemy2", sourceType: "unit",
      targetId: "Unit#1", type: "condition", key: "burned", value: 1,
    });

    bus.on("Test", (p, ctx) => {
      handler.execute({ targetId: "Unit#1" }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2);
    expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(0);
    expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(0);
  });

  test("returns list of removed conditions", () => {
    stack.apply({
      sourceId: "X", sourceType: "unit",
      targetId: "Unit#1", type: "condition", key: "stunned", value: 1,
    });

    let result;
    bus.on("Test", (p, ctx) => {
      result = handler.execute({ targetId: "Unit#1" }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(result.cleansed.length).toBe(1);
    expect(result.cleansed[0].condition).toBe("stunned");
  });

  test("no-op when target has no conditions", () => {
    let result;
    bus.on("Test", (p, ctx) => {
      result = handler.execute({ targetId: "Unit#1" }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");
    expect(result.cleansed).toEqual([]);
  });

  test("emits state:condition:cleansed child event", () => {
    stack.apply({
      sourceId: "X", sourceType: "unit",
      targetId: "Unit#1", type: "condition", key: "doomed", value: 1,
    });

    const listener = jest.fn();
    bus.on("state:condition:cleansed", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ targetId: "Unit#1" }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].removed[0].condition).toBe("doomed");
  });
});
