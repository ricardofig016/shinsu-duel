import { EVENTS, buildDebugEvent } from "./protocol.js";

/**
 * The dev room's event firehose.
 *
 * Subscribes a wildcard observer on the session game's event bus and
 * broadcasts one compact `debug-event` line per root event to both seats, so a
 * developer watching the browser console sees the engine's event chain as it
 * happens. Nested events (children of the current root event) are not streamed
 * as separate lines: the Logger's causation tree already carries that
 * structure, and the console can pull it with the logger-dump query.
 *
 * The streamer follows the event bridge's contract: it only reads payloads and
 * hands protocol messages to the session, so a delivery failure is recorded on
 * the emit result and can never abort an authoritative event chain. Its
 * subscription takes an explicit `sourceAge` for the same reason the bridge
 * does: a default registration would consume a GameClock tick and shift every
 * clock value the replay artifact records.
 */
export default class EventFirehose {
  #session;
  #sequence = 0;

  constructor({ session }) {
    if (!session || typeof session.broadcast !== "function") {
      throw new TypeError("EventFirehose needs a session exposing broadcast.");
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
      throw new Error("EventFirehose.subscribe requires the session's game to be started.");
    }

    return game.eventBus.on(
      "*",
      (payload, context) => {
        if (context.depth !== 0) return;
        if (!this.#session.isFirehoseEnabled) return;

        this.#sequence += 1;
        const line = buildDebugEvent({
          sequence: this.#sequence,
          eventName: context.eventName,
          payload,
        });
        this.#session.broadcast(EVENTS.GAME_DEBUG_EVENT, () => line);
      },
      { phase: "post", role: "observer", sourceAge: 0 }
    );
  }
}
