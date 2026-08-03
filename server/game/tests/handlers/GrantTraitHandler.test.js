import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import ModifierStack from "../../ModifierStack.js";
import GrantTraitHandler from "../../handlers/GrantTraitHandler.js";

describe("GrantTraitHandler", () => {
  let clock, bus, stack, gameState, handler;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    stack = new ModifierStack(bus, clock);
    handler = new GrantTraitHandler();
    gameState = { modifierStack: stack };
  });

  test("grants a trait to a target via the modifier stack", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Equip#1",
        targetId: "Unit#1",
        trait: "strong",
        amount: 2,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(stack.getEffective("Unit#1", "trait", "strong")).toBe(2);
    expect(stack.has("Unit#1", "trait", "strong")).toBe(true);
  });

  test("trait modifier is tracked by sourceId", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Equip#FrogFisher",
        targetId: "Unit#1",
        trait: "barrier",
        amount: 1,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(stack.getSources("Unit#1")).toContain("Equip#FrogFisher");
  });

  test("default amount is 1", () => {
    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Card#1",
        targetId: "Unit#1",
        trait: "lethal",
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");
    expect(stack.getEffective("Unit#1", "trait", "lethal")).toBe(1);
  });

  test("emits state:trait:granted child event", () => {
    const listener = jest.fn();
    bus.on("state:trait:granted", listener, { phase: "post" });

    bus.on("Test", (p, ctx) => {
      handler.execute({
        sourceId: "Card#1",
        targetId: "Unit#1",
        trait: "pierce",
        amount: 1,
      }, ctx, gameState);
    }, { phase: "execute" });

    bus.emit("Test");

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].trait).toBe("pierce");
  });

  test("validate throws when required fields are missing", () => {
    expect(() => handler.validate({})).toThrow("targetId");
    expect(() => handler.validate({ targetId: "U1" })).toThrow("trait");
    expect(() => handler.validate({ targetId: "U1", trait: "strong" })).toThrow("sourceId");
    expect(() => handler.validate({ targetId: "U1", trait: "strong", sourceId: "S1" })).not.toThrow();
  });
});
