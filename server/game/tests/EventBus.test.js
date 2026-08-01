import { jest } from "@jest/globals";
import EventBus from "../EventBus.js";

describe("EventBus", () => {
  test("supports dynamic events and returned unsubscribe functions", () => {
    const bus = new EventBus();
    const handler = jest.fn();
    const unsubscribe = bus.on("CustomEvent", handler);

    bus.emit("CustomEvent", { value: 1 });
    unsubscribe();
    bus.emit("CustomEvent", { value: 2 });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ value: 1 }, expect.objectContaining({ phase: "execute" }));
  });

  test("orders handlers by priority and registration order", () => {
    const bus = new EventBus();
    const calls = [];

    bus.on("Order", () => calls.push("late"), { priority: 10 });
    bus.on("Order", () => calls.push("first"), { priority: -10 });
    bus.on("Order", () => calls.push("middle-a"), { priority: 0 });
    bus.on("Order", () => calls.push("middle-b"), { priority: 0 });

    bus.emit("Order");

    expect(calls).toEqual(["first", "middle-a", "middle-b", "late"]);
  });

  test("allows payload mutation and cancellation in pre phase", () => {
    const bus = new EventBus();
    bus.on("Damage", (payload) => {
      payload.amount -= 2;
    }, { phase: "pre", priority: -10 });
    bus.on("Damage", (payload, context) => {
      payload.amount = 0;
      context.cancel("barrier");
    }, { phase: "pre", priority: 0 });

    const result = bus.emit("Damage", { amount: 5 }, { phase: "pre" });

    expect(result.modifiedPayload).toEqual({ amount: 0 });
    expect(result.cancelled).toBe(true);
    expect(result.reason).toBe("barrier");
  });

  test("supports once, off, and removeAllListeners", () => {
    const bus = new EventBus();
    const onceHandler = jest.fn();
    const regularHandler = jest.fn();

    bus.once("Cleanup", onceHandler);
    bus.on("Cleanup", regularHandler);
    bus.emit("Cleanup");
    bus.emit("Cleanup");
    bus.off("Cleanup", regularHandler);
    bus.emit("Cleanup");

    expect(onceHandler).toHaveBeenCalledTimes(1);
    expect(regularHandler).toHaveBeenCalledTimes(2);

    bus.on("A", regularHandler);
    bus.on("B", regularHandler);
    bus.removeAllListeners();
    bus.emit("A");
    bus.emit("B");
    expect(regularHandler).toHaveBeenCalledTimes(2);
  });

  test("publish remains compatible and runs post subscribers", () => {
    const bus = new EventBus();
    const postHandler = jest.fn();
    const resolvedHandler = jest.fn();
    bus.on("Legacy", postHandler, { phase: "post" });
    bus.on("Legacy", resolvedHandler, { phase: "resolved" });

    const result = bus.publish("Legacy", { ok: true });

    expect(postHandler).toHaveBeenCalledTimes(1);
    expect(resolvedHandler).toHaveBeenCalledTimes(1);
    expect(result.modifiedPayload).toEqual({ ok: true });
  });
});