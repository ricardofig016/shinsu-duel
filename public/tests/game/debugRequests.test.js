import { createQueryTracker } from "../../game/debugRequests.js";

/**
 * The dev console's query bookkeeping. The bug that shaped it: a refusal that
 * names no query (a rejected mutation) was treated as an answer to every query
 * in flight, failing a query the server was still answering.
 */

/** A clock the test drives itself, so nothing waits on real time. */
const makeClock = () => {
  let nextId = 0;
  const timers = new Map();
  return {
    setTimer(fn, ms) {
      const id = ++nextId;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimer(id) {
      timers.delete(id);
    },
    fire() {
      const armed = [...timers.values()];
      timers.clear();
      for (const timer of armed) timer.fn();
    },
    get armed() {
      return [...timers.values()].map((timer) => timer.ms);
    },
  };
};

describe("dev console query tracker", () => {
  test("each query gets its own id and settles with its own result", async () => {
    const clock = makeClock();
    const queries = createQueryTracker({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    const first = queries.begin("hand");
    const second = queries.begin("deck");
    expect(first.requestId).toBe("q1");
    expect(second.requestId).toBe("q2");
    expect(queries.size).toBe(2);

    expect(queries.resolve(second.requestId, { cards: [] })).toBe(true);
    await expect(second.promise).resolves.toEqual({ cards: [] });
    expect(queries.size).toBe(1);

    expect(queries.resolve(first.requestId, { cards: ["a"] })).toBe(true);
    await expect(first.promise).resolves.toEqual({ cards: ["a"] });
    expect(queries.size).toBe(0);
    expect(clock.armed).toEqual([]);
  });

  test("a refusal that names no query leaves the queries in flight alone", async () => {
    const clock = makeClock();
    const queries = createQueryTracker({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    const query = queries.begin("state");
    expect(queries.refuse(undefined, "The dev console is only available in dev rooms (TESTROOMxx).")).toBe(false);
    expect(queries.size).toBe(1);
    expect(clock.armed).toHaveLength(1);

    expect(queries.resolve(query.requestId, { round: 2 })).toBe(true);
    await expect(query.promise).resolves.toEqual({ round: 2 });
  });

  test("a refusal that names the query rejects it", async () => {
    const clock = makeClock();
    const queries = createQueryTracker({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    const query = queries.begin("unit-abilities");
    expect(queries.refuse(query.requestId, "Unit u1 is not on the field.")).toBe(true);
    await expect(query.promise).rejects.toThrow("Unit u1 is not on the field.");
    expect(queries.size).toBe(0);
    expect(clock.armed).toEqual([]);
  });

  test("an unanswered query rejects on its own timeout", async () => {
    const clock = makeClock();
    const queries = createQueryTracker({
      timeoutMs: 250,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });

    const query = queries.begin("logs");
    expect(clock.armed).toEqual([250]);

    clock.fire();
    await expect(query.promise).rejects.toThrow("Query q1 (logs) was never answered.");
    expect(queries.size).toBe(0);
  });

  test("a settled query can never settle twice", async () => {
    const clock = makeClock();
    const queries = createQueryTracker({ setTimer: clock.setTimer, clearTimer: clock.clearTimer });

    const query = queries.begin("hand");
    expect(queries.resolve(query.requestId, { cards: [] })).toBe(true);
    expect(queries.resolve(query.requestId, { cards: ["late"] })).toBe(false);
    expect(queries.refuse(query.requestId, "too late")).toBe(false);
    expect(queries.resolve("q99", { cards: [] })).toBe(false);
    await expect(query.promise).resolves.toEqual({ cards: [] });
  });

  test("a malformed tracker configuration fails loudly", () => {
    expect(() => createQueryTracker({ timeoutMs: 0 })).toThrow(TypeError);
    expect(() => createQueryTracker({ setTimer: null })).toThrow(TypeError);
    expect(() =>
      createQueryTracker({ setTimer: () => 1, clearTimer: () => {} }).begin("")
    ).toThrow(TypeError);
  });
});
