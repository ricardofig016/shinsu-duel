import { jest } from "@jest/globals";
import EventBus from "../EventBus.js";
import GameClock from "../GameClock.js";
import Logger from "../Logger.js";

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
});
