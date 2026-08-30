import GameSession from "./GameSession.js";

/**
 * Maps room codes to their game sessions.
 *
 * Sessions are created on demand and live until the process dies or
 * `reset()` is called: a room's game outlives its sockets so players can
 * drop and rejoin into the exact state they left. The session factory is
 * injectable so tests can substitute their own session construction.
 */
export default class SessionRegistry {
  #sessions = new Map();
  #createSession;

  constructor({ createSession = (args) => new GameSession(args) } = {}) {
    if (typeof createSession !== "function") {
      throw new TypeError("createSession must be a function.");
    }
    this.#createSession = createSession;
  }

  /**
   * Return the room's session, creating it on first request. Passing a room
   * whose session already exists returns that session unchanged — session
   * identity comes from the room code, never from the caller's snapshot of
   * the room record.
   */
  ensureSession({ roomCode, usernames, seed, createGame }) {
    const existing = this.#sessions.get(roomCode);
    if (existing) return existing;

    const session = this.#createSession({ roomCode, usernames, seed, createGame });
    this.#sessions.set(roomCode, session);
    return session;
  }

  get(roomCode) {
    return this.#sessions.get(roomCode) ?? null;
  }

  get size() {
    return this.#sessions.size;
  }

  /** Drop every session. Test hook — production keeps sessions for the process lifetime. */
  reset() {
    this.#sessions.clear();
  }
}
