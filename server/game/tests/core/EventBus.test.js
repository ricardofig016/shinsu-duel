import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";

describe("EventBus", () => {
  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  describe("registration", () => {
    test("on() returns unsubscribe function that removes the handler", () => {
      const bus = new EventBus();
      const handler = jest.fn();
      const unsub = bus.on("Test", handler);
      bus.emit("Test", { x: 1 });
      expect(handler).toHaveBeenCalledTimes(1);
      unsub();
      bus.emit("Test", { x: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test("once() handler fires exactly once then is removed", () => {
      const bus = new EventBus();
      const handler = jest.fn();
      bus.once("Test", handler);
      bus.emit("Test");
      bus.emit("Test");
      bus.emit("Test");
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test("once() unsubscribe before fire prevents execution", () => {
      const bus = new EventBus();
      const handler = jest.fn();
      const unsub = bus.once("Test", handler);
      unsub();
      bus.emit("Test");
      expect(handler).toHaveBeenCalledTimes(0);
    });

    test("off() removes a specific handler by reference", () => {
      const bus = new EventBus();
      const a = jest.fn();
      const b = jest.fn();
      bus.on("Test", a);
      bus.on("Test", b);
      bus.off("Test", a);
      bus.emit("Test");
      expect(a).toHaveBeenCalledTimes(0);
      expect(b).toHaveBeenCalledTimes(1);
    });

    test("removeAllListeners(eventName) clears only that event", () => {
      const bus = new EventBus();
      const a = jest.fn();
      const b = jest.fn();
      bus.on("A", a);
      bus.on("B", b);
      bus.removeAllListeners("A");
      bus.emit("A");
      bus.emit("B");
      expect(a).toHaveBeenCalledTimes(0);
      expect(b).toHaveBeenCalledTimes(1);
    });

    test("removeAllListeners() without arguments clears everything", () => {
      const bus = new EventBus();
      const a = jest.fn();
      bus.on("A", a);
      bus.on("B", a);
      bus.removeAllListeners();
      bus.emit("A");
      bus.emit("B");
      expect(a).toHaveBeenCalledTimes(0);
    });

    test("wildcard * matches all events", () => {
      const bus = new EventBus();
      const handler = jest.fn();
      bus.on("*", handler, { phase: "post" });
      bus.emit("A");
      bus.emit("B");
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler.mock.calls[0][1].eventName).toBe("A");
      expect(handler.mock.calls[1][1].eventName).toBe("B");
    });

    test("rejects empty event name", () => {
      const bus = new EventBus();
      expect(() => bus.on("", () => {})).toThrow("non-empty string");
    });

    test("rejects non-function handler", () => {
      const bus = new EventBus();
      expect(() => bus.on("Test", "notfn")).toThrow("must be a function");
    });

    test("rejects invalid phase", () => {
      const bus = new EventBus();
      expect(() => bus.on("Test", () => {}, { phase: "nope" })).toThrow("Invalid event phase");
    });

    test("rejects non-finite priority", () => {
      const bus = new EventBus();
      expect(() => bus.on("Test", () => {}, { priority: NaN })).toThrow("finite number");
    });
  });

  // -----------------------------------------------------------------------
  // Phase ordering
  // -----------------------------------------------------------------------

  describe("phase ordering", () => {
    test("runs phases in order: pre → execute → post → resolved", () => {
      const bus = new EventBus();
      const order = [];
      bus.on("Test", () => order.push("pre"), { phase: "pre" });
      bus.on("Test", () => order.push("execute"), { phase: "execute" });
      bus.on("Test", () => order.push("post"), { phase: "post" });
      bus.on("Test", () => order.push("resolved"), { phase: "resolved" });
      bus.emit("Test");
      expect(order).toEqual(["pre", "execute", "post", "resolved"]);
    });

    test("skips remaining phases when cancelled in pre", () => {
      const bus = new EventBus();
      const order = [];
      bus.on("Test", (p, ctx) => { order.push("pre"); ctx.cancel("nope"); }, { phase: "pre" });
      bus.on("Test", () => order.push("execute"), { phase: "execute" });
      bus.on("Test", () => order.push("post"), { phase: "post" });
      const result = bus.emit("Test");
      expect(order).toEqual(["pre"]);
      expect(result.cancelled).toBe(true);
      expect(result.reason).toBe("nope");
    });

    test("skips remaining phases when cancelled in execute", () => {
      const bus = new EventBus();
      const order = [];
      bus.on("Test", () => order.push("pre"), { phase: "pre" });
      bus.on("Test", (p, ctx) => { order.push("execute"); ctx.cancel(); }, { phase: "execute" });
      bus.on("Test", () => order.push("post"), { phase: "post" });
      const result = bus.emit("Test");
      expect(order).toEqual(["pre", "execute"]);
      expect(result.cancelled).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Priority and ordering
  // -----------------------------------------------------------------------

  describe("priority and ordering", () => {
    test("sorts by priority ascending within a phase", () => {
      const bus = new EventBus();
      const calls = [];
      bus.on("Test", () => calls.push("p10"), { priority: 10 });
      bus.on("Test", () => calls.push("p-10"), { priority: -10 });
      bus.on("Test", () => calls.push("p0"), { priority: 0 });
      bus.emit("Test");
      expect(calls).toEqual(["p-10", "p0", "p10"]);
    });

    test("uses sourceAge for tiebreaking when priority equal", () => {
      const clock = new GameClock();
      const bus = new EventBus(clock);
      const calls = [];
      const age1 = clock.now(); // 0
      const age2 = clock.now(); // 1
      const age3 = clock.now(); // 2

      bus.on("Test", () => calls.push("youngest"), { priority: 0, sourceAge: age3 });
      bus.on("Test", () => calls.push("oldest"), { priority: 0, sourceAge: age1 });
      bus.on("Test", () => calls.push("middle"), { priority: 0, sourceAge: age2 });

      bus.emit("Test");
      expect(calls).toEqual(["oldest", "middle", "youngest"]);
    });

    test("uses registration order as final tiebreaker", () => {
      const clock = new GameClock();
      const bus = new EventBus(clock);
      const calls = [];
      const age = clock.now();

      bus.on("Test", () => calls.push("first"), { priority: 0, sourceAge: age });
      bus.on("Test", () => calls.push("second"), { priority: 0, sourceAge: age });
      bus.on("Test", () => calls.push("third"), { priority: 0, sourceAge: age });

      bus.emit("Test");
      expect(calls).toEqual(["first", "second", "third"]);
    });
  });

  // -----------------------------------------------------------------------
  // DFS nesting
  // -----------------------------------------------------------------------

  describe("DFS nesting", () => {
    test("child event fully resolves before sibling handler runs", () => {
      const bus = new EventBus();
      const timeline = [];

      bus.on("Parent", (p, ctx) => {
        timeline.push("A-start");
        ctx.emitChild("Child", {});
        timeline.push("A-end");
      }, { priority: 0 });

      bus.on("Parent", () => timeline.push("B"), { priority: 0 });

      bus.on("Child", () => timeline.push("child-pre"), { phase: "pre" });
      bus.on("Child", () => timeline.push("child-exec"), { phase: "execute" });
      bus.on("Child", () => timeline.push("child-post"), { phase: "post" });

      bus.emit("Parent");
      expect(timeline).toEqual([
        "A-start", "child-pre", "child-exec", "child-post", "A-end", "B",
      ]);
    });

    test("multi-level DFS: grandchild resolves before parent post", () => {
      const bus = new EventBus();
      const timeline = [];

      bus.on("Root", (p, ctx) => {
        timeline.push("root-exec");
        ctx.emitChild("Child", {});
        timeline.push("root-after-child");
      }, { phase: "execute" });

      bus.on("Root", () => timeline.push("root-post"), { phase: "post" });

      bus.on("Child", (p, ctx) => {
        timeline.push("child-exec");
        ctx.emitChild("Grandchild", {});
        timeline.push("child-after-grandchild");
      }, { phase: "execute" });

      bus.on("Grandchild", () => timeline.push("gc-exec"), { phase: "execute" });
      bus.on("Grandchild", () => timeline.push("gc-post"), { phase: "post" });

      bus.emit("Root");
      expect(timeline).toEqual([
        "root-exec", "child-exec", "gc-exec", "gc-post",
        "child-after-grandchild", "root-after-child", "root-post",
      ]);
    });

    test("child events from different handlers resolve independently", () => {
      const bus = new EventBus();
      const timeline = [];

      bus.on("Parent", (p, ctx) => {
        timeline.push("A");
        ctx.emitChild("Child", { id: 1 });
      }, { priority: 0 });

      bus.on("Parent", (p, ctx) => {
        timeline.push("B");
        ctx.emitChild("Child", { id: 2 });
      }, { priority: 1 });

      bus.on("Child", (p) => timeline.push(`child-${p.id}`), { phase: "execute" });

      bus.emit("Parent");
      expect(timeline).toEqual(["A", "child-1", "B", "child-2"]);
    });
  });

  // -----------------------------------------------------------------------
  // Cancellation
  // -----------------------------------------------------------------------

  describe("cancellation", () => {
    test("cancel in pre prevents execute and post", () => {
      const bus = new EventBus();
      const exec = jest.fn();
      const post = jest.fn();
      bus.on("Test", (p, ctx) => ctx.cancel("blocked"), { phase: "pre" });
      bus.on("Test", exec, { phase: "execute" });
      bus.on("Test", post, { phase: "post" });
      const result = bus.emit("Test");
      expect(exec).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(result.cancelled).toBe(true);
      expect(result.reason).toBe("blocked");
    });

    test("child events already ran before parent cancel — expected DFS behavior", () => {
      const bus = new EventBus();
      const timeline = [];
      bus.on("Parent", (p, ctx) => {
        timeline.push("parent-start");
        ctx.emitChild("Child", {});
        timeline.push("parent-cancel");
        ctx.cancel("done");
      }, { phase: "execute" });
      bus.on("Parent", () => timeline.push("parent-post"), { phase: "post" });
      bus.on("Child", () => timeline.push("child-exec"), { phase: "execute" });
      bus.emit("Parent");
      expect(timeline).toEqual(["parent-start", "child-exec", "parent-cancel"]);
    });
  });

  // -----------------------------------------------------------------------
  // Failure handling
  // -----------------------------------------------------------------------

  describe("failure handling", () => {
    test("a handler failure stops later mutations and reaction phases", () => {
      const bus = new EventBus();
      const state = { mutations: 0, reactions: 0 };
      const laterMutation = jest.fn(() => { state.mutations++; });
      const reaction = jest.fn(() => { state.reactions++; });

      bus.on("Test", () => {
        state.mutations++;
        throw new Error("boom");
      }, { phase: "execute" });
      bus.on("Test", laterMutation, { phase: "execute" });
      bus.on("Test", reaction, { phase: "post" });

      expect(() => bus.emit("Test")).toThrow("[Test:execute]");
      expect(state).toEqual({ mutations: 1, reactions: 0 });
      expect(laterMutation).not.toHaveBeenCalled();
      expect(reaction).not.toHaveBeenCalled();
    });

    test("error message includes event name, phase, and handler info", () => {
      const bus = new EventBus();
      const myHandler = () => { throw new Error("specific error"); };
      bus.on("DamageCalc", myHandler, { phase: "execute" });
      try { bus.emit("DamageCalc"); } catch (e) {
        expect(e.message).toContain("DamageCalc");
        expect(e.message).toContain("execute");
        expect(e.message).toContain("specific error");
      }
    });

    test("error in child event bubbles up to parent emission", () => {
      const bus = new EventBus();
      const timeline = [];
      bus.on("Parent", (p, ctx) => {
        timeline.push("parent");
        ctx.emitChild("Child", {});
        timeline.push("parent-after");
      }, { phase: "execute" });
      bus.on("Child", () => { throw new Error("child boom"); }, { phase: "execute" });
      expect(() => bus.emit("Parent")).toThrow("child boom");
      expect(timeline).toEqual(["parent"]);
    });
  });

  // -----------------------------------------------------------------------
  // Handler roles (authoritative vs observer)
  // -----------------------------------------------------------------------

  describe("handler roles", () => {
    test("rejects an invalid role at registration", () => {
      const bus = new EventBus();
      expect(() => bus.on("Test", () => {}, { role: "watcher" })).toThrow("Invalid event handler role");
    });

    test("default role is authoritative: failure aborts dispatch", () => {
      const bus = new EventBus();
      const later = jest.fn();
      bus.on("Test", () => { throw new Error("authoritative boom"); });
      bus.on("Test", later);
      expect(() => bus.emit("Test")).toThrow("[Test:execute]");
      expect(later).not.toHaveBeenCalled();
    });

    test("observer failure is isolated and dispatch continues", () => {
      const bus = new EventBus();
      const later = jest.fn();
      const observer = () => { throw new Error("observer boom"); };
      bus.on("Test", observer, { role: "observer", phase: "execute" });
      bus.on("Test", later, { phase: "execute" });

      const result = bus.emit("Test");

      expect(later).toHaveBeenCalledTimes(1);
      expect(result.observerErrors).toHaveLength(1);
      expect(result.observerErrors[0].message).toContain("observer boom");
      expect(result.observerErrors[0].eventName).toBe("Test");
      expect(result.observerErrors[0].phase).toBe("execute");
      expect(result.observerErrors[0].handlerName).toBe("observer");
    });

    test("observer failure in a child event does not abort the parent", () => {
      const bus = new EventBus();
      const timeline = [];
      bus.on("Parent", (p, ctx) => {
        timeline.push("parent-start");
        const child = ctx.emitChild("Child", {});
        timeline.push(`child-errors:${child.observerErrors.length}`);
        timeline.push("parent-after");
      }, { phase: "execute" });
      bus.on("Child", () => { throw new Error("child observer boom"); }, { role: "observer", phase: "execute" });

      const result = bus.emit("Parent");

      expect(timeline).toEqual(["parent-start", "child-errors:1", "parent-after"]);
      expect(result.observerErrors).toHaveLength(0); // isolated to the child result
    });

    test("authoritative failure in a child still bubbles to the root", () => {
      const bus = new EventBus();
      bus.on("Parent", (p, ctx) => ctx.emitChild("Child", {}), { phase: "execute" });
      bus.on("Child", () => { throw new Error("authoritative child boom"); }, { phase: "execute" });
      expect(() => bus.emit("Parent")).toThrow("authoritative child boom");
    });

    test("single-phase emit records observer errors instead of throwing", () => {
      const bus = new EventBus();
      bus.on("Test", () => { throw new Error("observer boom"); }, { role: "observer", phase: "pre" });
      const result = bus.emit("Test", {}, { phase: "pre" });
      expect(result.observerErrors).toHaveLength(1);
      expect(result.observerErrors[0].message).toContain("observer boom");
    });

    test("clean emit returns an empty observerErrors array", () => {
      const bus = new EventBus();
      const result = bus.emit("NoHandlers");
      expect(result.observerErrors).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // Abort notification
  // -----------------------------------------------------------------------

  describe("onAbort", () => {
    test("is invoked for an authoritative failure with metadata", () => {
      const bus = new EventBus();
      const aborts = [];
      bus.onAbort((error, info) => aborts.push({ error, info }));
      bus.on("Test", () => { throw new Error("boom"); }, { phase: "execute" });

      expect(() => bus.emit("Test")).toThrow("boom");
      expect(aborts).toHaveLength(1);
      expect(aborts[0].info.eventName).toBe("Test");
      expect(aborts[0].info.phase).toBe("execute");
      expect(aborts[0].info.handlerName).toBeDefined();
      expect(aborts[0].error.message).toContain("boom");
    });

    test("is NOT invoked for an observer failure", () => {
      const bus = new EventBus();
      const aborts = [];
      bus.onAbort(() => aborts.push(true));
      bus.on("Test", () => { throw new Error("observer boom"); }, { role: "observer" });

      bus.emit("Test");
      expect(aborts).toHaveLength(0);
    });

    test("a throwing abort listener does not mask the original error", () => {
      const bus = new EventBus();
      bus.onAbort(() => { throw new Error("listener boom"); });
      bus.on("Test", () => { throw new Error("original boom"); });

      expect(() => bus.emit("Test")).toThrow("original boom");
    });

    test("returns an unsubscribe function", () => {
      const bus = new EventBus();
      const aborts = [];
      const unsub = bus.onAbort(() => aborts.push(true));
      unsub();
      bus.on("Test", () => { throw new Error("boom"); });
      expect(() => bus.emit("Test")).toThrow("boom");
      expect(aborts).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // Recursion guard
  // -----------------------------------------------------------------------

  describe("recursion guard", () => {
    test("throws when max depth is exceeded", () => {
      const bus = new EventBus(undefined, 5);
      bus.on("Loop", (p, ctx) => ctx.emitChild("Loop", {}), { phase: "execute" });
      expect(() => bus.emit("Loop")).toThrow("max recursion depth");
    });
  });

  // -----------------------------------------------------------------------
  // Determinism
  // -----------------------------------------------------------------------

  describe("determinism", () => {
    test("same setup produces identical handler call order every time", () => {
      const run = () => {
        const clock = new GameClock();
        const bus = new EventBus(clock);
        const calls = [];
        const a1 = clock.now();
        const a2 = clock.now();
        bus.on("Test", () => calls.push("older"), { priority: 0, sourceAge: a1 });
        bus.on("Test", () => calls.push("newer"), { priority: 0, sourceAge: a2 });
        bus.on("Test", () => calls.push("post-older"), { phase: "post", priority: 0, sourceAge: a1 });
        bus.emit("Test");
        return calls;
      };
      const first = run();
      for (let i = 0; i < 20; i++) {
        expect(run()).toEqual(first);
      }
    });
  });

  // -----------------------------------------------------------------------
  // Single-phase emit
  // -----------------------------------------------------------------------

  describe("single-phase emit", () => {
    test("emit with phase option only runs that phase", () => {
      const bus = new EventBus();
      const pre = jest.fn();
      const exec = jest.fn();
      bus.on("Test", pre, { phase: "pre" });
      bus.on("Test", exec, { phase: "execute" });
      bus.emit("Test", {}, { phase: "pre" });
      expect(pre).toHaveBeenCalledTimes(1);
      expect(exec).toHaveBeenCalledTimes(0);
    });
  });

  // -----------------------------------------------------------------------
  // Payload mutation
  // -----------------------------------------------------------------------

  describe("payload mutation", () => {
    test("pre handlers can modify the payload before execute sees it", () => {
      const bus = new EventBus();
      let captured = null;
      bus.on("Damage", (p) => { p.amount -= 2; }, { phase: "pre" });
      bus.on("Damage", (p) => { captured = p.amount; }, { phase: "execute" });
      bus.emit("Damage", { amount: 5 });
      expect(captured).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  describe("edge cases", () => {
    test("emitting event with zero handlers returns clean result", () => {
      const bus = new EventBus();
      const result = bus.emit("NoHandlers", { x: 1 });
      expect(result.cancelled).toBe(false);
      expect(result.finalPayload).toEqual({ x: 1 });
    });

    test("off() with non-function handler does not throw", () => {
      const bus = new EventBus();
      bus.on("Test", () => {});
      expect(() => bus.off("Test", null)).not.toThrow();
      expect(() => bus.off("Test", "string")).not.toThrow();
    });

    test("off() for non-existent event does not throw", () => {
      const bus = new EventBus();
      expect(() => bus.off("NoExist", () => {})).not.toThrow();
    });

    test("default phase is execute when not specified", () => {
      const bus = new EventBus();
      let capturedPhase = null;
      bus.on("Test", (p, ctx) => { capturedPhase = ctx.phase; });
      bus.emit("Test");
      expect(capturedPhase).toBe("execute");
    });
  });
});
