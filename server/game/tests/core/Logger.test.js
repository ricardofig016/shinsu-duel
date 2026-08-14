import { jest } from "@jest/globals";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import Logger from "../../Logger.js";

describe("Logger", () => {
  let clock, bus, logger;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    logger = new Logger(bus, {
      debug: false,
      snapshotFn: () => ({ round: 1, hp: 5, shinsu: 3 }),
    });
  });

  test("captures root events with state diffs", () => {
    bus.emit("game:round:start", { round: 2 });

    const logs = logger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].rootEvent).toBe("game:round:start");
    expect(logs[0].stateBefore).toBeDefined();
    expect(logs[0].stateAfter).toBeDefined();
    expect(logs[0].diff).toBeDefined();
    expect(logs[0].causationTree).toBeDefined();
  });

  test("records causation tree with children", () => {
    bus.on("Parent", (p, ctx) => {
      ctx.emitChild("Child", { x: 1 });
      ctx.emitChild("Child", { x: 2 });
    }, { phase: "execute" });

    bus.on("Child", (p, ctx) => {
      ctx.emitChild("Grandchild", {});
    }, { phase: "execute" });

    bus.emit("Parent");

    const logs = logger.getLogs();
    // Only the root "Parent" event is logged (children are nested in tree)
    expect(logs.length).toBe(1);

    const tree = logs[0].causationTree;
    expect(tree.eventName).toBe("Parent");
    expect(tree.children.length).toBe(2);
    expect(tree.children[0].eventName).toBe("Child");
    expect(tree.children[0].children[0].eventName).toBe("Grandchild");
  });

  test("records cancellation state", () => {
    bus.on("Test", (p, ctx) => ctx.cancel("nope"), { phase: "pre" });

    bus.emit("Test");

    const logs = logger.getLogs();
    expect(logs[0].cancelled).toBe(true);
    expect(logs[0].cancelReason).toBe("nope");
  });

  test("child events are NOT logged as separate root entries", () => {
    bus.on("Root", (p, ctx) => {
      ctx.emitChild("Child", {});
    }, { phase: "execute" });

    bus.emit("Root");

    // Logger only logs depth=0 (root) events
    const logs = logger.getLogs();
    expect(logs.length).toBe(1);
    expect(logs[0].rootEvent).toBe("Root");
  });

  test("getLogs returns a copy (immutable from outside)", () => {
    bus.emit("Test", {});
    const logs = logger.getLogs();
    logs.push({ fake: true });
    expect(logger.getLogs().length).toBe(1);
  });

  test("clear() empties the log", () => {
    bus.emit("Test", {});
    expect(logger.getLogs().length).toBe(1);
    logger.clear();
    expect(logger.getLogs().length).toBe(0);
  });

  test("debug mode adds console backend without errors", () => {
    const debugLogger = new Logger(bus, {
      debug: true,
      snapshotFn: () => ({}),
    });

    expect(() => bus.emit("DebugTest", {})).not.toThrow();
    expect(debugLogger.getLogs().length).toBe(1);
  });

  test("addBackend allows custom backends", () => {
    const customLogs = [];
    const customBackend = {
      write: (entry) => customLogs.push(entry),
      getAll: () => customLogs,
      clear: () => { customLogs.length = 0; },
    };

    logger.addBackend(customBackend);
    bus.emit("Test", { x: 42 });

    expect(customLogs.length).toBe(1);
    expect(customLogs[0].rootEvent).toBe("Test");
  });

  test("computes correct diff for state changes", () => {
    let state = { a: 1, b: "hello" };
    const stateLogger = new Logger(bus, {
      snapshotFn: () => ({ ...state }),
    });

    bus.on("Mutate", () => { state.a = 2; delete state.b; state.c = true; }, { phase: "execute" });

    bus.emit("Mutate");

    const logs = stateLogger.getLogs();
    const diff = logs[0].diff;

    // a changed from 1 to 2
    expect(diff.changed).toContainEqual({ key: "a", old: 1, new: 2 });
    // b was removed
    expect(diff.removed).toContainEqual({ key: "b" });
    // c was added
    expect(diff.added).toContainEqual({ key: "c", value: true });
  });

  test("captures the original payload before handlers mutate it", () => {
    bus.on("Mutate", (payload) => { payload.amount = 999; }, { phase: "execute" });
    bus.emit("Mutate", { amount: 5 });

    const entry = logger.getLogs()[0];
    expect(entry.originalPayload).toEqual({ amount: 5 });
  });

  test("records a full-depth causation tree (4+ levels)", () => {
    bus.on("A", (p, ctx) => ctx.emitChild("B", {}), { phase: "execute" });
    bus.on("B", (p, ctx) => ctx.emitChild("C", {}), { phase: "execute" });
    bus.on("C", (p, ctx) => ctx.emitChild("D", {}), { phase: "execute" });
    bus.emit("A");

    const tree = logger.getLogs()[0].causationTree;
    expect(tree.eventName).toBe("A");
    expect(tree.children[0].eventName).toBe("B");
    expect(tree.children[0].children[0].eventName).toBe("C");
    expect(tree.children[0].children[0].children[0].eventName).toBe("D");
  });

  test("records an EventFailure entry via onAbort", () => {
    bus.on("Boom", () => { throw new Error("authoritative failure"); }, { phase: "execute" });
    expect(() => bus.emit("Boom")).toThrow("authoritative failure");

    const failure = logger.getLogs().find((l) => l.type === "EventFailure");
    expect(failure).toBeDefined();
    expect(failure.eventName).toBe("Boom");
    expect(failure.phase).toBe("execute");
    expect(failure.error.message).toContain("authoritative failure");
  });

  test("records deterministic sequence instead of a wall-clock timestamp", () => {
    bus.emit("Test");
    const entry = logger.getLogs()[0];
    expect(entry.sequence).toBeGreaterThan(0);
    expect(entry.timestamp).toBeUndefined();
  });

  test("records InitialState and UserAction entries", () => {
    const fullState = { round: 1 };
    const stateLogger = new Logger(bus, {
      snapshotFn: () => ({}),
      serializeFn: () => ({ ...fullState }),
    });

    stateLogger.recordInitialState({ roomCode: "R", usernames: ["Alice", "Bob"] });
    stateLogger.beginUserInput({ kind: "action", payload: { type: "pass" } });
    fullState.round = 2;
    stateLogger.endUserInput({ ok: true });

    const logs = stateLogger.getLogs();
    const initial = logs.find((l) => l.type === "InitialState");
    const action = logs.find((l) => l.type === "UserAction");
    expect(initial.meta.roomCode).toBe("R");
    expect(initial.state).toEqual({ round: 1 });
    expect(action.action).toEqual({ type: "pass" });
    expect(action.stateBefore).toEqual({ round: 1 });
    expect(action.stateAfter).toEqual({ round: 2 });
    expect(action.ok).toBe(true);
  });

  test("getReplayLog returns a JSON-safe initial + actions structure", () => {
    const stateLogger = new Logger(bus, {
      snapshotFn: () => ({}),
      serializeFn: () => ({ round: 3 }),
    });
    stateLogger.recordInitialState({ roomCode: "R" });
    stateLogger.beginUserInput({ kind: "action", payload: { type: "pass" } });
    stateLogger.endUserInput({ ok: true });

    const replay = stateLogger.getReplayLog();
    expect(replay.initial.type).toBe("InitialState");
    expect(replay.actions).toHaveLength(1);
    expect(replay.actions[0].type).toBe("UserAction");
    // Round-trips through JSON (deep-clone guarantee).
    expect(JSON.parse(JSON.stringify(replay))).toEqual(replay);
  });
});
