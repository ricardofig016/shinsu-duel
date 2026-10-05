import { jest } from "@jest/globals";
import SeededRng from "../../game/utils/SeededRng.js";
import { EVENTS } from "../../game/net/protocol.js";
import BotSeatController, { BOT_ACTION_DELAY_MS } from "../BotSeatController.js";
import { moveKey } from "../turnOptions.js";

const EVENT_INIT = EVENTS.GAME_INIT;
const EVENT_UPDATE = EVENTS.GAME_UPDATE;
const EVENT_ERROR = EVENTS.GAME_ERROR;
const EVENT_OVER = EVENTS.GAME_OVER;

const PASS_ACTION = { type: "pass-turn-action", data: {} };

/** A manual scheduler: captures `(delayMs, task)` and flushes on demand. */
function manualScheduler() {
  const tasks = [];
  const scheduler = (delayMs, task) => tasks.push({ delayMs, task });
  return {
    tasks,
    scheduler,
    flush() {
      const pending = [...tasks];
      tasks.length = 0;
      for (const { task } of pending) task();
      return pending;
    },
    pendingCount() {
      return tasks.length;
    },
    lastDelay() {
      return tasks.length ? tasks[tasks.length - 1].delayMs : null;
    },
  };
}

/** A fake session registry whose live session can be swapped at any time. */
function fakeRegistry() {
  const sessions = new Map();
  return {
    sessions,
    get: (roomCode) => sessions.get(roomCode) ?? null,
  };
}

/** A fake submitter recording every validated submission. */
function fakeSubmitter() {
  return {
    actions: [],
    decisions: [],
    submitAction({ session, username, connection, action }) {
      this.actions.push({ session, username, connection, action });
    },
    submitDecision({ session, username, connection, decision }) {
      this.decisions.push({ session, username, connection, decision });
    },
  };
}

/** A stub playstyle recording every call and returning fixed output. */
function stubPlaystyle(turnAction = null) {
  const action = () => turnAction ?? { type: "pass-turn-action", data: {} };
  return {
    decideTurn: jest.fn(action),
    resolveRetry: jest.fn(action),
    resolveDecision: jest.fn(() => ({ decisionId: "d1", choices: ["a"] })),
  };
}

/**
 * A playstyle whose first move and whose retries are scripted, recording what
 * each call was told to exclude. A script shorter than the calls made repeats
 * its last entry, which is how a test pins "the pool has nothing new to offer".
 */
function scriptedPlaystyle({ first = PASS_ACTION, retries = [PASS_ACTION], decision = null } = {}) {
  const turnCalls = [];
  const retryCalls = [];
  const playstyle = {
    turnCalls,
    retryCalls,
    decideTurn: jest.fn((view, rng, excluded) => {
      turnCalls.push({ view, excluded: new Set(excluded ?? []) });
      return first;
    }),
    resolveRetry: jest.fn((view, excluded, rng) => {
      retryCalls.push({ view, excluded: new Set(excluded ?? []) });
      return retries[Math.min(retryCalls.length - 1, retries.length - 1)];
    }),
    resolveDecision: jest.fn(() => decision ?? { decisionId: "d1", choices: ["a"] }),
  };
  return playstyle;
}

const seatView = (overrides = {}) => ({
  round: 1,
  currentTurn: "[BOT] Whatever",
  gameOver: null,
  you: {
    username: "[BOT] Whatever",
    passButton: { isEnabled: true, text: "Pass Turn" },
    pendingDecision: null,
    hand: [],
    shinsu: { normalAvailable: 2, recharged: 0 },
    ...overrides.you,
  },
  opponent: {},
  ...overrides.rest,
});

function controllerFor({ playstyle = stubPlaystyle(), registry = fakeRegistry(), scheduler = manualScheduler(), rng = new SeededRng(1), delayMs, onLog, submitter = fakeSubmitter() } = {}) {
  const bot = new BotSeatController({
    roomCode: "ROOM01",
    seatName: "[BOT] Whatever",
    playstyle,
    rng,
    registry,
    submitter,
    scheduler: scheduler.scheduler,
    delayMs,
    onLog,
  });
  return { bot, submitter, playstyle, registry, scheduler };
}

const startedSession = () => ({ isStarted: true });

/** Drive one rejection plus the retry it schedules. */
function rejectAndRetry(bot, scheduler, message = "refused") {
  bot.send(EVENT_ERROR, { message });
  scheduler.flush();
}

describe("BotSeatController", () => {
  test("is its own connection: attaching is passing the controller itself", () => {
    const { bot, registry } = controllerFor();
    expect(bot.connection).toBe(bot);
    expect(typeof bot.send).toBe("function");
    void registry;
  });

  test("submits a playstyle turn action once its turn is enabled", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView());

    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();

    expect(submitter.decisions).toHaveLength(0);
    expect(submitter.actions).toHaveLength(1);
    const { session, username, connection, action } = submitter.actions[0];
    expect(session).toBe(registry.sessions.get("ROOM01"));
    expect(username).toBe("[BOT] Whatever");
    expect(connection).toBe(bot);
    expect(action).toEqual({ type: "pass-turn-action", data: {} });
  });

  test("stays idle when it is not the bot's turn", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView({ you: { passButton: { isEnabled: false, text: "" } } }));
    scheduler.flush();

    expect(submitter.actions).toHaveLength(0);
  });

  test("resolves a pending decision before taking any turn action", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView({
      you: {
        passButton: { isEnabled: true, text: "Pass Turn" },
        pendingDecision: { decisionId: "d9", candidates: [{ id: "x" }], minChoices: 1, maxChoices: 1, lockedIds: [] },
      },
    }));
    scheduler.flush();

    expect(submitter.decisions).toHaveLength(1);
    expect(submitter.decisions[0].decision).toEqual({ decisionId: "d1", choices: ["a"] });
    expect(submitter.decisions[0].username).toBe("[BOT] Whatever");
    expect(submitter.actions).toHaveLength(0);
  });

  test("reads the registry fresh on every move, so a replaced session is followed", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    const first = startedSession();
    registry.sessions.set("ROOM01", first);
    bot.send(EVENT_INIT, seatView());
    scheduler.flush();
    expect(submitter.actions[0].session).toBe(first);

    const replacement = startedSession();
    registry.sessions.set("ROOM01", replacement);
    bot.send(EVENT_UPDATE, seatView());
    scheduler.flush();
    expect(submitter.actions[1].session).toBe(replacement);
  });

  test("never submits while the room's session is absent or not started", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    bot.send(EVENT_INIT, seatView());
    scheduler.flush();
    expect(submitter.actions).toHaveLength(0);

    registry.sessions.set("ROOM01", { isStarted: false });
    bot.send(EVENT_UPDATE, seatView());
    scheduler.flush();
    expect(submitter.actions).toHaveLength(0);
  });

  test("one move is in flight at a time, and the newest view wins", () => {
    const { bot, submitter, playstyle, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());

    bot.send(EVENT_INIT, seatView({ rest: { round: 1 } }));
    bot.send(EVENT_UPDATE, seatView({ rest: { round: 2 } }));
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.flush();
    expect(playstyle.decideTurn).toHaveBeenCalledTimes(1);
    expect(playstyle.decideTurn.mock.calls[0][0].round).toBe(2);
    expect(submitter.actions).toHaveLength(1);
  });

  test("acts with the configured delay and the documented default of 0 ms", () => {
    const { bot, scheduler, registry } = controllerFor({ delayMs: 120 });
    expect(BOT_ACTION_DELAY_MS).toBe(0);

    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView());
    expect(scheduler.lastDelay()).toBe(120);
  });

  test("stops acting for good on game over", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());

    bot.send(EVENT_UPDATE, seatView({ rest: { gameOver: { winner: "Alice", reason: "lighthouses" } } }));
    scheduler.flush();
    expect(submitter.actions).toHaveLength(0);

    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_UPDATE, seatView());
    expect(scheduler.pendingCount()).toBe(0);
  });

  test("stops acting on the game-over event itself", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_OVER, { winner: "Alice", reason: "lighthouses" });

    bot.send(EVENT_UPDATE, seatView());
    scheduler.flush();
    expect(submitter.actions).toHaveLength(0);
  });

  describe("the refusal retry", () => {
    test("retries a refused move with the refused key excluded and submits the playstyle's next move", () => {
      const refused = { type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "scout" } };
      const next = { type: "generate-fire-charge-action", data: {} };
      const playstyle = scriptedPlaystyle({ first: refused, retries: [next] });
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView());
      scheduler.flush();
      expect(submitter.actions[0].action).toEqual(refused);

      rejectAndRetry(bot, scheduler, "You already have \"Grinder\" deployed.");

      expect(submitter.actions).toHaveLength(2);
      expect(submitter.actions[1].action).toEqual(next);
      expect(playstyle.retryCalls).toHaveLength(1);
      expect(playstyle.retryCalls[0].excluded.has(moveKey(refused))).toBe(true);
    });

    test("never submits a move already refused for the current snapshot", () => {
      const repeated = { type: "generate-fire-charge-action", data: {} };
      const playstyle = scriptedPlaystyle({ first: repeated, retries: [repeated, repeated, repeated] });
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView());
      scheduler.flush();
      for (let attempt = 0; attempt < 3; attempt++) rejectAndRetry(bot, scheduler);

      expect(submitter.actions).toHaveLength(1);
      expect(scheduler.pendingCount()).toBe(0);
    });

    test("a fully refused pool drains to a pass and terminates", () => {
      const moves = [
        { type: "generate-fire-charge-action", data: {} },
        { type: "play-skill-action", data: { handId: 0 } },
        { type: "deploy-unit-action", data: { handId: 1, placedPositionCode: "scout" } },
        { type: "switch-position-action", data: { unitId: "Unit#1", positionCode: "backline" } },
      ];
      const playstyle = scriptedPlaystyle({ first: moves[0], retries: [...moves.slice(1), PASS_ACTION, PASS_ACTION] });
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView());
      scheduler.flush();
      for (let attempt = 0; attempt < 8; attempt++) rejectAndRetry(bot, scheduler);

      const submitted = submitter.actions.map((entry) => moveKey(entry.action));
      expect(submitted).toEqual([...moves, PASS_ACTION].map(moveKey));
      expect(new Set(submitted).size).toBe(submitted.length);
      expect(submitted[submitted.length - 1]).toBe(moveKey(PASS_ACTION));
    });

    test("clears the attempted set on the next snapshot", () => {
      const firstMove = { type: "play-skill-action", data: { handId: 0 } };
      const retryMove = { type: "generate-fire-charge-action", data: {} };
      const playstyle = scriptedPlaystyle({ first: firstMove, retries: [retryMove] });
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView());
      scheduler.flush();
      rejectAndRetry(bot, scheduler, "nope");
      expect(submitter.actions).toHaveLength(2);

      bot.send(EVENT_UPDATE, seatView());
      scheduler.flush();

      // The new snapshot re-arms the seat: the move the last one refused is
      // offered again, and the playstyle is handed an empty exclusion set.
      expect(submitter.actions).toHaveLength(3);
      expect(playstyle.turnCalls[1].excluded.size).toBe(0);
      expect(submitter.actions[2].action).toEqual(firstMove);
    });

    test("a middle rejection after a success does not re-attempt an earlier move", () => {
      const firstMove = { type: "play-skill-action", data: { handId: 0 } };
      const secondMove = { type: "deploy-unit-action", data: { handId: 1, placedPositionCode: "scout" } };
      const playstyle = scriptedPlaystyle({ first: firstMove, retries: [secondMove, firstMove] });
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView());
      scheduler.flush(); // the first move is submitted
      rejectAndRetry(bot, scheduler, "refused"); // and refused; the retry offers the second
      expect(submitter.actions[1].action).toEqual(secondMove);

      rejectAndRetry(bot, scheduler, "refused again"); // the retry offers the first move again

      // The first move is the one this snapshot already refused, so it is not
      // submitted a second time and the snapshot ends quietly.
      const submitted = submitter.actions.map((entry) => moveKey(entry.action));
      expect(submitted).toEqual([moveKey(firstMove), moveKey(secondMove)]);
      expect(new Set(submitted).size).toBe(submitted.length);
      expect(scheduler.pendingCount()).toBe(0);
    });

    test("a refused decision is retried through the playstyle's resolveRetry", () => {
      const playstyle = {
        decideTurn: jest.fn(() => PASS_ACTION),
        resolveRetry: jest.fn(() => ({ decisionId: "d7", choices: ["b"] })),
        resolveDecision: jest.fn(() => ({ decisionId: "d7", choices: ["a"] })),
      };
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView({
        you: {
          passButton: { isEnabled: true, text: "Pass Turn" },
          pendingDecision: { decisionId: "d7", candidates: [{ id: "a" }, { id: "b" }], minChoices: 1, maxChoices: 1, lockedIds: [] },
        },
      }));
      scheduler.flush();
      expect(submitter.decisions[0].decision).toEqual({ decisionId: "d7", choices: ["a"] });

      rejectAndRetry(bot, scheduler, "Decision contains an invalid candidate.");
      expect(submitter.decisions).toHaveLength(2);
      expect(submitter.decisions[1].decision).toEqual({ decisionId: "d7", choices: ["b"] });
      expect(playstyle.resolveRetry.mock.calls[0][1].has(moveKey({ decisionId: "d7", choices: ["a"] }))).toBe(true);
    });

    test("goes quiet when the playstyle has nothing new to offer", () => {
      const onLog = jest.fn();
      const same = { type: "generate-fire-charge-action", data: {} };
      const playstyle = scriptedPlaystyle({ first: same, retries: [same] });
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle, onLog });
      registry.sessions.set("ROOM01", startedSession());

      bot.send(EVENT_INIT, seatView());
      scheduler.flush();
      rejectAndRetry(bot, scheduler);

      expect(submitter.actions).toHaveLength(1);
      expect(onLog).toHaveBeenCalledWith("debug", "Bot retry exhausted", expect.objectContaining({ seatName: "[BOT] Whatever" }));
    });

    test("does nothing when the bot has nothing to do", () => {
      const { bot, submitter, scheduler, registry } = controllerFor();
      registry.sessions.set("ROOM01", startedSession());
      bot.send(EVENT_INIT, seatView({ you: { passButton: { isEnabled: false, text: "" } } }));
      scheduler.flush();
      expect(submitter.actions).toHaveLength(0);

      bot.send(EVENT_ERROR, { message: "someone else's problem" });
      scheduler.flush();
      expect(submitter.actions).toHaveLength(0);
    });

    test("a playstyle that throws is treated as a failed move and retried once", () => {
      const playstyle = {
        decideTurn: jest.fn(() => { throw new Error("boom"); }),
        resolveRetry: jest.fn(() => PASS_ACTION),
        resolveDecision: jest.fn(),
      };
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
      registry.sessions.set("ROOM01", startedSession());
      bot.send(EVENT_INIT, seatView());
      scheduler.flush();

      expect(playstyle.decideTurn).toHaveBeenCalledTimes(1);
      expect(submitter.actions).toHaveLength(0);
      expect(scheduler.pendingCount()).toBe(1); // the retry
      scheduler.flush();
      expect(playstyle.resolveRetry).toHaveBeenCalledTimes(1);
      expect(submitter.actions).toHaveLength(1);
      expect(submitter.actions[0].action).toEqual(PASS_ACTION);
    });

    test("a retry that throws is logged and ends the snapshot", () => {
      const onLog = jest.fn();
      const playstyle = {
        decideTurn: jest.fn(() => PASS_ACTION),
        resolveRetry: jest.fn(() => { throw new Error("boom"); }),
        resolveDecision: jest.fn(),
      };
      const { bot, submitter, scheduler, registry } = controllerFor({ playstyle, onLog });
      registry.sessions.set("ROOM01", startedSession());
      bot.send(EVENT_INIT, seatView());
      scheduler.flush();

      rejectAndRetry(bot, scheduler);

      expect(submitter.actions).toHaveLength(1);
      expect(onLog).toHaveBeenCalledWith("error", "Bot retry failed", expect.objectContaining({ seatName: "[BOT] Whatever" }));
      expect(scheduler.pendingCount()).toBe(0);
    });

    test("a submission that throws is logged, never fatal", () => {
      const onLog = jest.fn();
      const { bot, registry, scheduler } = controllerFor({
        onLog,
        submitter: {
          submitAction: () => { throw new Error("gateway is broken"); },
          submitDecision: () => {},
        },
      });
      registry.sessions.set("ROOM01", startedSession());
      bot.send(EVENT_INIT, seatView());
      scheduler.flush();

      expect(onLog).toHaveBeenCalledWith("error", "Bot submission failed", expect.objectContaining({ seatName: "[BOT] Whatever" }));
      expect(scheduler.pendingCount()).toBe(0);
    });
  });

  test("logs rejections through onLog when one is provided", () => {
    const onLog = jest.fn();
    const { bot } = controllerFor({ onLog });
    bot.send(EVENT_ERROR, { message: "Broken" });
    expect(onLog).toHaveBeenCalledWith("warn", "Bot move rejected", expect.objectContaining({ seatName: "[BOT] Whatever" }));
  });

  test("ignores events that are not bot business", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send("game-hand-peek", { reveal: {} });
    bot.send("game-deck-status", { seats: [] });
    bot.send("debug-event", { sequence: 1 });
    bot.send("game-waiting", {});

    expect(scheduler.pendingCount()).toBe(0);
    expect(submitter.actions).toHaveLength(0);
    expect(submitter.decisions).toHaveLength(0);
  });

  describe("constructor validation", () => {
    const valid = () => ({
      roomCode: "ROOM01",
      seatName: "[BOT] Whatever",
      playstyle: stubPlaystyle(),
      rng: new SeededRng(1),
      registry: fakeRegistry(),
      submitter: fakeSubmitter(),
    });

    test("rejects a missing playstyle contract", () => {
      expect(() => new BotSeatController({ ...valid(), playstyle: {} })).toThrow(TypeError);
      expect(() => new BotSeatController({ ...valid(), playstyle: { decideTurn() {} } })).toThrow(TypeError);
      expect(() => new BotSeatController({ ...valid(), playstyle: { decideTurn() {}, resolveDecision() {} } })).toThrow(
        TypeError
      );
      expect(() => new BotSeatController({ ...valid(), playstyle: { decideTurn() {}, resolveRetry() {} } })).toThrow(TypeError);
    });

    test("rejects a rng without next()", () => {
      expect(() => new BotSeatController({ ...valid(), rng: {} })).toThrow(TypeError);
    });

    test("rejects a registry without get", () => {
      expect(() => new BotSeatController({ ...valid(), registry: {} })).toThrow(TypeError);
    });

    test("rejects a submitter missing a validated path", () => {
      expect(() => new BotSeatController({ ...valid(), submitter: { submitAction: () => {} } })).toThrow(TypeError);
    });

    test("rejects a negative or non-finite delay", () => {
      expect(() => new BotSeatController({ ...valid(), delayMs: -1 })).toThrow(TypeError);
      expect(() => new BotSeatController({ ...valid(), delayMs: Number.POSITIVE_INFINITY })).toThrow(TypeError);
    });

    test("rejects a non-function scheduler", () => {
      expect(() => new BotSeatController({ ...valid(), scheduler: 7 })).toThrow(TypeError);
    });

    test("rejects empty strings and a non-function onLog", () => {
      expect(() => new BotSeatController({ ...valid(), seatName: "" })).toThrow(TypeError);
      expect(() => new BotSeatController({ ...valid(), onLog: 7 })).toThrow(TypeError);
    });
  });
});
