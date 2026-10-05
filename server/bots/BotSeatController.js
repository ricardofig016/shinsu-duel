import { EVENTS } from "../game/net/protocol.js";
import { moveKey } from "./turnOptions.js";

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
 * view seen so far.
 *
 * A rejection does not spend the turn. The controller keeps the set of moves
 * it has attempted for the current snapshot — cleared on every snapshot — and
 * adds a refused move's key to it before asking the playstyle for another
 * move that excludes everything already attempted. The bound is structural
 * rather than a counter: a playstyle may only offer a move the projection has
 * not offered before for that snapshot, and the projection's pool is finite,
 * so the retry drains to a pass on its own. When a playstyle has nothing new
 * to offer — or offers a move already refused — the controller goes quiet
 * until the next snapshot.
 *
 * The controller owns no fallback of its own: on a rejection it asks the
 * playstyle, through `resolveRetry(view, excluded, rng)`, which may answer
 * with a turn action or with a pending-decision resolution. It never picks a
 * move itself.
 *
 * The driver goes quiet for good on game over.
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
  #attempted = new Set();
  #lastMove = null;
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
    if (
      typeof playstyle?.decideTurn !== "function" ||
      typeof playstyle?.resolveRetry !== "function" ||
      typeof playstyle?.resolveDecision !== "function"
    ) {
      throw new TypeError(
        "playstyle must expose decideTurn(view, rng, excluded), resolveRetry(view, excluded, rng), and resolveDecision(decision, rng)."
      );
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
   * Deliver one outbound event to the seat. State views drive the move loop,
   * a rejection triggers a retry from the newest view, game over stops the
   * driver for good, and everything else (hand peeks, deck status, the
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

  /** A new snapshot re-arms the seat: the moves attempted for the old one are spent. */
  #onStateView(payload) {
    if (!payload || typeof payload !== "object") return;
    if (payload.gameOver) {
      this.#stopped = true;
      this.#latestView = null;
      return;
    }
    this.#latestView = payload;
    this.#attempted.clear();
    this.#lastMove = null;
    this.#schedule(() => this.#act());
  }

  /**
   * A rejection adds the refused move to the attempted set and hands the
   * choice of the next move back to the playstyle, excluding that set.
   */
  #onGameError(payload) {
    this.#log("warn", "Bot move rejected", { seatName: this.#seatName, reason: payload?.message ?? "unknown" });
    if (this.#stopped || this.#inFlight) return;
    if (this.#lastMove) this.#attempted.add(moveKey(this.#lastMove));
    this.#schedule(() => this.#retry());
  }

  /** Schedule one task, never more than one at a time. */
  #schedule(task) {
    if (this.#stopped || this.#inFlight) return;
    this.#inFlight = true;
    this.#scheduler(this.#delayMs, () => {
      this.#inFlight = false;
      task();
    });
  }

  /** The seat's first move for the snapshot it was handed. */
  #act() {
    const view = this.#latestView;
    if (!view || this.#stopped) return;
    const session = this.#playableSession();
    if (!session) return;

    const decision = view.you?.pendingDecision;
    let move;
    try {
      if (decision) {
        this.#log("debug", "Bot resolves decision", { seatName: this.#seatName });
        move = this.#playstyle.resolveDecision(decision, this.#rng);
      } else if (view.you?.passButton?.isEnabled) {
        move = this.#playstyle.decideTurn(view, this.#rng, this.#attempted);
      } else {
        return;
      }
    } catch (error) {
      // A playstyle bug is a failed move like an engine rejection: try the
      // playstyle's retry path once, never crashing the broadcast stack frame
      // the scheduled move runs in.
      this.#log("error", "Bot playstyle failed", { seatName: this.#seatName, error: error?.message ?? String(error) });
      this.#schedule(() => this.#retry());
      return;
    }

    this.#submit(session, move, decision ? "decision" : "action");
  }

  /**
   * The retry after a refusal: the playstyle answers with the next move,
   * excluding everything attempted. A move already attempted, a move the view
   * cannot submit right now, or a playstyle with nothing left all end the
   * retry quietly — the drain that replaces a retry counter.
   */
  #retry() {
    const view = this.#latestView;
    if (!view || this.#stopped) return;
    const session = this.#playableSession();
    if (!session) return;

    const decision = view.you?.pendingDecision ?? null;
    let move;
    try {
      move = this.#playstyle.resolveRetry(view, this.#attempted, this.#rng);
    } catch (error) {
      this.#log("error", "Bot retry failed", { seatName: this.#seatName, error: error?.message ?? String(error) });
      return;
    }

    if (!move || typeof move !== "object") {
      this.#log("debug", "Bot retry exhausted", { seatName: this.#seatName });
      return;
    }

    const isDecision = typeof move.decisionId === "string";
    if (isDecision) {
      if (!decision) return;
    } else if (decision || !view.you?.passButton?.isEnabled) {
      return;
    }

    const key = moveKey(move);
    if (this.#attempted.has(key)) {
      this.#log("debug", "Bot retry exhausted", { seatName: this.#seatName });
      return;
    }

    this.#submit(session, move, isDecision ? "decision" : "action");
  }

  /**
   * Submit one move through the gateway's validated path. A throw here is an
   * infrastructure failure rather than an engine refusal, so it is logged and
   * ends the snapshot's attempt rather than looping.
   */
  #submit(session, move, kind) {
    this.#lastMove = move;
    this.#attempted.add(moveKey(move));
    try {
      if (kind === "decision") {
        this.#submitter.submitDecision({ session, username: this.#seatName, connection: this, decision: move });
      } else {
        this.#submitter.submitAction({ session, username: this.#seatName, connection: this, action: move });
      }
    } catch (error) {
      this.#log("error", "Bot submission failed", { seatName: this.#seatName, error: error?.message ?? String(error) });
    }
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
