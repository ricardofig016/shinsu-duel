import { EVENTS, buildDebugEvent } from "./protocol.js";

/**
 * The dev room's event firehose.
 *
 * Subscribes a wildcard observer on the session game's event bus and streams
 * one compact `debug-event` line per root event to both seats, so a developer
 * watching the browser console sees the engine's event chain as it happens.
 * Nested events (children of the current root event) are not streamed as
 * separate lines: the Logger's causation tree already carries that structure,
 * and the console can pull it with the logger-dump query.
 *
 * The stream belongs to the game, not to a connection, and it covers the game
 * from its first event. A game announces its own start from inside its
 * constructor (`game:started`, the opening `round:started` and `turn:started`),
 * before any observer can attach to its bus, so the stream opens with the root
 * events the Logger already recorded and keeps every line it has produced: the
 * seats attached when the game starts receive them immediately, and a
 * connection that attaches while the game is running receives them through
 * `catchUp`.
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
  /** Every line this stream has produced, oldest first. */
  #lines = [];

  constructor({ session }) {
    if (!session || typeof session.broadcast !== "function") {
      throw new TypeError("EventFirehose needs a session exposing broadcast.");
    }
    this.#session = session;
  }

  /**
   * Subscribe to the session game's event bus, opening the stream with the
   * events the game produced before this subscription existed. The game must
   * be started. Returns the unsubscribe function.
   */
  subscribe() {
    const game = this.#session.game;
    if (!game?.eventBus) {
      throw new Error("EventFirehose.subscribe requires the session's game to be started.");
    }

    for (const line of this.#recordedLines(game)) {
      this.#lines.push(line);
      this.#broadcast(line);
    }

    return game.eventBus.on(
      "*",
      (payload, context) => {
        if (context.depth !== 0) return;
        if (!this.#session.isFirehoseEnabled) return;

        const line = buildDebugEvent({
          sequence: this.#lines.length + 1,
          eventName: context.eventName,
          payload,
        });
        this.#lines.push(line);
        this.#broadcast(line);
      },
      { phase: "post", role: "observer", sourceAge: 0 }
    );
  }

  /**
   * Send one connection the whole stream so far, so a console that attaches
   * while the game is already running still sees the game from its first event.
   * A silenced stream catches a connection up with nothing.
   *
   * @param {{ send: (event: string, payload: object) => void }} connection
   */
  catchUp(connection) {
    if (typeof connection?.send !== "function") {
      throw new TypeError("EventFirehose.catchUp needs a connection exposing send.");
    }
    if (!this.#session.isFirehoseEnabled) return;

    for (const line of this.#lines) connection.send(EVENTS.GAME_DEBUG_EVENT, line);
  }

  /**
   * The root events the game produced before this stream could attach: the
   * Logger records every root event with the payload it carried before any
   * handler touched it, which is exactly what a line needs.
   */
  #recordedLines(game) {
    const entries = game.logger?.getLogs?.() ?? [];
    return entries
      .filter((entry) => typeof entry.rootEvent === "string")
      .map((entry, index) =>
        buildDebugEvent({
          sequence: index + 1,
          eventName: entry.rootEvent,
          payload: entry.originalPayload,
        })
      );
  }

  #broadcast(line) {
    this.#session.broadcast(EVENTS.GAME_DEBUG_EVENT, () => line);
  }
}
