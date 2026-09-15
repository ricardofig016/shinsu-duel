import { jest } from "@jest/globals";
import SeededRng from "../../game/utils/SeededRng.js";
import { EVENTS } from "../../game/net/protocol.js";
import BotSeatController, { BOT_ACTION_DELAY_MS } from "../BotSeatController.js";

const EVENT_INIT = EVENTS.GAME_INIT;
const EVENT_UPDATE = EVENTS.GAME_UPDATE;
const EVENT_ERROR = EVENTS.GAME_ERROR;
const EVENT_OVER = EVENTS.GAME_OVER;

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
function stubPlaystyle(turnAction = null, decisionChoices = null) {
  return {
    decideTurn: jest.fn(() => turnAction ?? { type: "pass-turn-action", data: {} }),
    resolveDecision: jest.fn(() => ({ decisionId: "d1", choices: ["a"] })),
  };
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

describe("BotSeatController", () => {
  test("is its own connection: attaching is passing the controller itself", () => {
    const { bot, registry } = controllerFor();
    expect(bot.connection).toBe(bot);
    expect(typeof bot.send).toBe("function");
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

  test("recovers exactly once per snapshot after its own move is rejected", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView());
    scheduler.flush();
    expect(submitter.actions).toHaveLength(1); // the bot's own move

    bot.send(EVENT_ERROR, { message: "Not enough shinsu to deploy this unit." });
    expect(scheduler.pendingCount()).toBe(1);
    scheduler.flush();
    expect(submitter.actions).toHaveLength(2); // the recovery move
    expect(submitter.actions[1].action).toEqual({ type: "pass-turn-action", data: {} });

    // A second rejection in the same snapshot never schedules another move.
    bot.send(EVENT_ERROR, { message: "still broken" });
    expect(scheduler.pendingCount()).toBe(0);
  });

  test("recovery resolves an open decision with the first valid choices", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView({
      you: {
        passButton: { isEnabled: true, text: "Pass Turn" },
        pendingDecision: { decisionId: "d7", candidates: [{ id: "a" }, { id: "b" }], minChoices: 1, maxChoices: 1, lockedIds: [] },
      },
    }));
    scheduler.flush();
    expect(submitter.decisions).toHaveLength(1);

    bot.send(EVENT_ERROR, { message: "Decision contains an invalid candidate." });
    scheduler.flush();
    expect(submitter.decisions).toHaveLength(2);
    expect(submitter.decisions[1].decision).toEqual({ decisionId: "d7", choices: ["a"] });
  });

  test("recovery does nothing when the bot has nothing to do", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView({ you: { passButton: { isEnabled: false, text: "" } } }));
    scheduler.flush();
    expect(submitter.actions).toHaveLength(0);

    bot.send(EVENT_ERROR, { message: "someone else's problem" });
    scheduler.flush();
    expect(submitter.actions).toHaveLength(0);
  });

  test("recovery re-arms when a new snapshot arrives", () => {
    const { bot, submitter, scheduler, registry } = controllerFor();
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView());
    scheduler.flush();
    expect(submitter.actions).toHaveLength(1); // the bot's own move

    bot.send(EVENT_ERROR, { message: "nope" });
    scheduler.flush();
    expect(submitter.actions).toHaveLength(2); // the recovery

    bot.send(EVENT_UPDATE, seatView());
    scheduler.flush();
    expect(submitter.actions).toHaveLength(3); // a fresh move on the new snapshot

    bot.send(EVENT_ERROR, { message: "nope again" });
    scheduler.flush();
    expect(submitter.actions).toHaveLength(4); // recovery re-armed
  });

  test("a playstyle that throws is treated as a failed move and recovered once", () => {
    const playstyle = {
      decideTurn: jest.fn(() => { throw new Error("boom"); }),
      resolveDecision: jest.fn(),
    };
    const { bot, submitter, scheduler, registry } = controllerFor({ playstyle });
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView());
    scheduler.flush();

    expect(playstyle.decideTurn).toHaveBeenCalledTimes(1);
    expect(submitter.actions).toHaveLength(0);
    expect(scheduler.pendingCount()).toBe(1); // the recovery move
    scheduler.flush();
    expect(submitter.actions).toHaveLength(1);
    expect(submitter.actions[0].action).toEqual({ type: "pass-turn-action", data: {} });
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

  test("logs rejections through onLog when one is provided", () => {
    const onLog = jest.fn();
    const { bot } = controllerFor({ onLog });
    bot.send(EVENT_ERROR, { message: "Broken" });
    expect(onLog).toHaveBeenCalledWith("warn", "Bot move rejected", expect.objectContaining({ seatName: "[BOT] Whatever" }));
  });

  test("a recovery submission that throws is logged, never fatal", () => {
    const onLog = jest.fn();
    let submissions = 0;
    const { bot, registry, scheduler } = controllerFor({
      onLog,
      submitter: {
        submitAction: () => {
          if (++submissions >= 2) throw new Error("gateway is broken");
        },
        submitDecision: () => {},
      },
    });
    registry.sessions.set("ROOM01", startedSession());
    bot.send(EVENT_INIT, seatView());
    scheduler.flush(); // the bot's own move goes through
    expect(submissions).toBe(1);

    bot.send(EVENT_ERROR, { message: "rejected" });
    scheduler.flush(); // the recovery submission throws inside the gateway

    expect(onLog).toHaveBeenCalledWith("error", "Bot recovery failed", expect.objectContaining({ seatName: "[BOT] Whatever" }));
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
