import EVT from "../EventCatalog.js";
import { EVENTS, buildHandPeek } from "./protocol.js";

/**
 * Delivers engine events that must reach a player outside the action and
 * decision response cycle, starting with the hand-peek reveal produced in
 * the middle of effect resolution.
 *
 * The bridge subscribes as an observer on the session game's event bus: it
 * only reads event payloads and hands protocol messages to the addressed
 * seat, so a delivery failure is recorded on the emit result and can never
 * abort an authoritative event chain.
 */
export default class EventBridge {
  #session;

  constructor({ session }) {
    if (!session || typeof session.sendTo !== "function") {
      throw new TypeError("EventBridge needs a session exposing sendTo.");
    }
    this.#session = session;
  }

  /**
   * Subscribe to the session game's event bus. The game must be started.
   * Returns the unsubscribe function.
   */
  subscribe() {
    const game = this.#session.game;
    if (!game?.eventBus) {
      throw new Error("EventBridge.subscribe requires the session's game to be started.");
    }

    return game.eventBus.on(
      EVT.HAND_PEEKED,
      (peek) => {
        this.#session.sendTo(peek.observer, EVENTS.GAME_HAND_PEEK, () => buildHandPeek(peek));
      },
      { phase: "post", role: "observer" }
    );
  }
}
