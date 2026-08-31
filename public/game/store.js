/**
 * Holds the latest authoritative game payload.
 *
 * The page keeps exactly one store; every inbound snapshot replaces the
 * previous one, and the DOM renderers read the current state through it.
 */
export function createGameStore() {
  let state = null;

  return {
    get state() {
      return state;
    },
    set(payload) {
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw new TypeError("The game payload must be a plain object.");
      }
      state = payload;
      return state;
    },
    clear() {
      state = null;
    },
  };
}
