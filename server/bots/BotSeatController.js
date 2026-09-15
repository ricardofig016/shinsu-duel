import { EVENTS } from "../game/net/protocol.js";
import { choiceCountRange, freeCandidateIds } from "./playstyles/decisions.js";

/**
 * How long a bot seat waits before submitting a move. The humanized-delay
 * design point: production bots act after a short randomized pause so their
 * moves read on the board, and the pause doubles as the re-entrancy guard
 * that keeps a bot reacting inside a broadcast stack frame from recursing.
 * While the project is in its playtesting stage the delay is 0 ms — a bot
 * answers on the next tick. This is a documented, deliberate value.
 */
export const BOT_ACTION_DELAY_MS = 0;

const defaultScheduler = (delayMs, task) => setTimeout(task, delayMs);

const PASS_ACTION = { type: "pass-turn-action", data: {} };

/**
 * A bot seat's connection and driver.
 *
 * The controller occupies a seat the same way a browser tab does: it
 * implements `send(event, payload)`, is attached with `session.attach`, and
 * submits every move through the gateway's validated paths, so identity
 * stamping, shape validation, and rejection delivery are identical to a
 * human player's. It reacts only to the snapshots its seat is delivered —
 * the same redacted payload a human seat sees — and never touches the
 * engine.
 *
 * One move is in flight at a time: a scheduled move always reads the newest
 * view seen so far. A rejection of its own input triggers at most one
 * recovery move (a first-valid decision resolution, or a pass while the
 * turn is open), and never more than one per snapshot, so a rejected move
 * can neither stall the game nor loop. The controller goes quiet for good
 * on game over.
 */
export default class BotSeatController {
  #roomCode;
  #seatName;
  #playstyle;
  #rng;
  #registry;
  #submitter;
  #scheduler;
  #delayMs;
  #onLog;
  #latestView = null;
  #inFlight = false;
  #recoveryUsed = false;
  #stopped = false;

  /**
   * @param {object} args
   * @param {string} args.roomCode the room whose session this seat plays in
   * @param {string} args.seatName the bot seat's username
   * @param {object} args.playstyle the playstyle driving this seat
   * @param {{ next(): number }} args.rng this seat's seeded rng
   * @param {object} args.registry the session registry; read fresh on every submission
   * @param {object} args.submitter the gateway's validated paths
   *   (`submitAction` / `submitDecision`, both `{ session, username, connection, ... }`)
   * @param {Function} [args.scheduler] `(delayMs, task) => void`; defaults to setTimeout
   * @param {number} [args.delayMs] how long a scheduled move waits; defaults to BOT_ACTION_DELAY_MS
   * @param {Function} [args.onLog] `(level, message, details) => void`; omitted logs are dropped
   */
  constructor({ roomCode, seatName, playstyle, rng, registry, submitter, scheduler = defaultScheduler, delayMs = BOT_ACTION_DELAY_MS, onLog = null }) {
    for (const [value, label] of [[roomCode, "roomCode"], [seatName, "seatName"]]) {
      if (typeof value !== "string" || value.trim() === "") {
        throw new TypeError(`${label} must be a non-empty string.`);
      }
    }
    if (typeof playstyle?.decideTurn !== "function" || typeof playstyle?.resolveDecision !== "function") {
      throw new TypeError("playstyle must expose decideTurn(view, rng) and resolveDecision(decision, rng).");
    }
    if (!rng || typeof rng.next !== "function") {
      throw new TypeError("rng must be a seeded rng with next().");
    }
    if (typeof registry?.get !== "function") {
      throw new TypeError("registry must expose get(roomCode).");
    }
    if (typeof submitter?.submitAction !== "function" || typeof submitter?.submitDecision !== "function") {
      throw new TypeError("submitter must expose submitAction and submitDecision.");
    }
    if (typeof scheduler !== "function") {
      throw new TypeError("scheduler must be a function.");
    }
    if (typeof delayMs !== "number" || !Number.isFinite(delayMs) || delayMs < 0) {
      throw new TypeError("delayMs must be a non-negative finite number.");
    }
    if (onLog !== null && typeof onLog !== "function") {
      throw new TypeError("onLog must be a function or null.");
    }

    this.#roomCode = roomCode;
    this.#seatName = seatName;
    this.#playstyle = playstyle;
    this.#rng = rng;
    this.#registry = registry;
    this.#submitter = submitter;
    this.#scheduler = scheduler;
    this.#delayMs = delayMs;
    this.#onLog = onLog;
  }

  /**
   * The controller is its own connection: attaching it to the bot seat is
   * `session.attach(seatName, controller)`, and every seat event arrives
   * through `send`.
   * @returns {BotSeatController}
   */
  get connection() {
    return this;
  }

  /**
   * Deliver one outbound event to the seat. State views drive the move
   * loop, a rejection triggers at most one recovery move, game over stops
   * the driver for good, and everything else (hand peeks, deck status, the
   * reveal, firehose lines) is not bot business.
   *
   * @param {string} event an event name from `EVENTS`
   * @param {object} payload the event payload, already built for this seat
   */
  send(event, payload) {
    if (event === EVENTS.GAME_INIT || event === EVENTS.GAME_UPDATE) {
      this.#onStateView(payload);
      return;
    }
    if (event === EVENTS.GAME_ERROR) {
      this.#onGameError(payload);
      return;
    }
    if (event === EVENTS.GAME_OVER) {
      this.#stopped = true;
      this.#latestView = null;
    }
  }

  #onStateView(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.gameOver) {
      this.#stopped = true;
      this.#latestView = null;
      return;
    }
    this.#latestView = payload;
    this.#recoveryUsed = false;
    this.#scheduleMove();
  }

  #onGameError(payload) {
    this.#log("warn", "Bot move rejected", { seatName: this.#seatName, reason: payload?.message ?? "unknown" });
    if (this.#stopped || this.#inFlight) return;
    this.#recoverOnce();
  }

  #scheduleMove() {
    if (this.#stopped || this.#inFlight) return;
    this.#inFlight = true;
    this.#scheduler(this.#delayMs, () => {
      this.#inFlight = false;
      this.#act();
    });
  }

  #scheduleRecovery() {
    if (this.#stopped || this.#inFlight) return;
    this.#inFlight = true;
    this.#scheduler(this.#delayMs, () => {
      this.#inFlight = false;
      this.#recover();
    });
  }

  #act() {
    const view = this.#latestView;
    if (!view || this.#stopped) return;
    const session = this.#playableSession();
    if (!session) return;

    const decision = view.you?.pendingDecision;
    try {
      if (decision) {
        this.#log("debug", "Bot resolves decision", { seatName: this.#seatName });
        this.#submitter.submitDecision({
          session,
          username: this.#seatName,
          connection: this,
          decision: this.#playstyle.resolveDecision(decision, this.#rng),
        });
        return;
      }

      if (view.you?.passButton?.isEnabled) {
        this.#submitter.submitAction({
          session,
          username: this.#seatName,
          connection: this,
          action: this.#playstyle.decideTurn(view, this.#rng),
        });
      }
    } catch (error) {
      // A playstyle bug is a failed move like an engine rejection: recover
      // once from the newest view, never crashing the broadcast stack frame
      // the scheduled move runs in.
      this.#log("error", "Bot playstyle failed", { seatName: this.#seatName, error: error?.message ?? String(error) });
      this.#recoverOnce();
    }
  }

  /**
   * The one-move fallback after a rejection: resolve an open decision with
   * the first valid choices, or pass while the turn is open. A pass is
   * always legal on the bot's own turn, so this cannot make things worse.
   */
  #recover() {
    const view = this.#latestView;
    if (!view || this.#stopped) return;
    const session = this.#playableSession();
    if (!session) return;

    const decision = view.you?.pendingDecision;
    try {
      if (decision) {
        const { min } = choiceCountRange(decision);
        this.#submitter.submitDecision({
          session,
          username: this.#seatName,
          connection: this,
          decision: { decisionId: decision.decisionId, choices: freeCandidateIds(decision).slice(0, min) },
        });
        return;
      }

      if (view.you?.passButton?.isEnabled) {
        this.#submitter.submitAction({ session, username: this.#seatName, connection: this, action: PASS_ACTION });
      }
    } catch (error) {
      // The recovery must never be the thing that kills the process.
      this.#log("error", "Bot recovery failed", { seatName: this.#seatName, error: error?.message ?? String(error) });
    }
  }

  /**
   * Recover at most once per snapshot. A rejection or a failed move marks
   * the snapshot's recovery as spent; the next accepted snapshot re-arms it.
   */
  #recoverOnce() {
    if (this.#recoveryUsed) return;
    this.#recoveryUsed = true;
    this.#scheduleRecovery();
  }

  /** The room's live session, or null while it is absent or not started. */
  #playableSession() {
    const session = this.#registry.get(this.#roomCode);
    return session && session.isStarted ? session : null;
  }

  #log(level, message, details) {
    this.#onLog?.(level, message, details);
  }
}
