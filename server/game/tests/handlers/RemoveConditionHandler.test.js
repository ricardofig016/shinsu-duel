import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import RemoveConditionHandler from "../../handlers/RemoveConditionHandler.js";
import EVT from "../../EventCatalog.js";

describe("RemoveConditionHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new RemoveConditionHandler();
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
    bus.on(EVT.CONDITION_CLEANSED, listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({ targetId: "Unit#1" }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].removed[0].condition).toBe("doomed");
  });

  test("mode random removes exactly the requested number of conditions", () => {
    gameState._rng = { next: () => 0.5 };
    stack.apply({ sourceId: "A", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "poisoned", value: 1 });
    stack.apply({ sourceId: "B", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "burned", value: 2 });
    stack.apply({ sourceId: "C", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "rooted", value: 1 });

    const ctx = { emitChild: (eventName, payload) => bus.emit(eventName, payload) };
    const result = handler.execute({ targetId: "Unit#1", mode: "random", amount: 1 }, ctx, gameState);

    expect(result.cleansed).toHaveLength(1);
    expect([...stack.getActiveKeys("Unit#1", "condition")]).toHaveLength(2);
  });

  test("mode random clamps amount to the number of available conditions", () => {
    gameState._rng = { next: () => 0 };
    stack.apply({ sourceId: "A", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "poisoned", value: 1 });
    stack.apply({ sourceId: "B", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "burned", value: 2 });

    const ctx = { emitChild: (eventName, payload) => bus.emit(eventName, payload) };
    const result = handler.execute({ targetId: "Unit#1", mode: "random", amount: 99 }, ctx, gameState);

    expect(result.cleansed).toHaveLength(2);
    expect([...stack.getActiveKeys("Unit#1", "condition")]).toHaveLength(0);
  });

  test("condition filter removes only the named condition, including all its stacks", () => {
    stack.apply({ sourceId: "A", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "burned", value: 1 });
    stack.apply({ sourceId: "B", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "burned", value: 2 });
    stack.apply({ sourceId: "C", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "poisoned", value: 2 });

    const ctx = { emitChild: (eventName, payload) => bus.emit(eventName, payload) };
    const result = handler.execute({ targetId: "Unit#1", condition: "burned" }, ctx, gameState);

    expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(0);
    expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(2);
    expect(result.cleansed).toHaveLength(2);
  });

  test("mode choose defers to a pending decision and removes chosen conditions on resolve", () => {
    stack.apply({ sourceId: "A", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "poisoned", value: 1 });
    stack.apply({ sourceId: "B", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "burned", value: 2 });
    stack.apply({ sourceId: "C", sourceType: "unit", targetId: "Unit#1", type: "condition", key: "rooted", value: 1 });

    let decision;
    gameState = {
      modifierStack: stack,
      usernames: ["Alice"],
      createPendingDecision: (d) => { decision = d; },
    };

    const ctx = { emitChild: (eventName, payload) => bus.emit(eventName, payload) };
    const result = handler.execute(
      { targetId: "Unit#1", mode: "choose", amount: 2, owner: "Alice" },
      ctx,
      gameState
    );

    expect(result.pending).toBe(true);
    expect(decision.type).toBe("remove_conditions");
    expect(decision.minChoices).toBe(2);
    expect(decision.maxChoices).toBe(2);
    expect(decision.candidates.map((c) => c.id).sort()).toEqual(["burned", "poisoned", "rooted"]);

    decision.resolve(["poisoned", "rooted"]);

    expect(stack.getEffective("Unit#1", "condition", "poisoned")).toBe(0);
    expect(stack.getEffective("Unit#1", "condition", "rooted")).toBe(0);
    expect(stack.getEffective("Unit#1", "condition", "burned")).toBe(2);
  });

  test("rejects an invalid mode", () => {
    expect(() => handler.validate({ targetId: "Unit#1", mode: "bogus" })).toThrow('invalid mode "bogus"');
  });

  test("requires a positive integer amount for random and choose modes", () => {
    expect(() => handler.validate({ targetId: "Unit#1", mode: "random" })).toThrow("positive integer amount");
    expect(() => handler.validate({ targetId: "Unit#1", mode: "choose", amount: 0 })).toThrow("positive integer amount");
  });
});
