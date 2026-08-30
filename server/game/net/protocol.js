/**
 * The wire contract of the game socket protocol.
 *
 * Every event name used by the net layer comes from `EVENTS`, and every
 * payload that goes on the wire is built here. Builders are pure: each one
 * validates its input, copies what it needs, and returns the exact object a
 * connection hands to the transport. The per-username state view wraps
 * `GameState.getClientState` and adds the session's revision counter, so a
 * client can tell whether it has missed a snapshot.
 */

export const EVENTS = {
  // Inbound (client → server)
  GAME_ACTION: "game-action",
  GAME_DECISION: "game-decision",
  GAME_STATE_REQUEST: "game-state-request",

  // Outbound (server → client)
  GAME_INIT: "game-init",
  GAME_UPDATE: "game-update",
  GAME_ERROR: "game-error",
  GAME_OVER: "game-over",
  GAME_WAITING: "game-waiting",
  GAME_HAND_PEEK: "game-hand-peek",
};

/**
 * Reserved Socket.IO transport events. They belong to the transport, not to
 * the game protocol, and cannot be renamed; they are listed here so the net
 * layer contains no raw event-name string literals.
 */
export const TRANSPORT_EVENTS = Object.freeze({
  CONNECT: "connection",
  DISCONNECT: "disconnect",
});

const WAITING_MESSAGE = "Waiting for the other player to join.";

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

/**
 * Build the full per-username snapshot for one seat.
 *
 * @param {object} args
 * @param {object} args.game the session's GameState
 * @param {number} args.revision the session's current revision counter
 * @param {string} args.username the seat the view is built for
 * @returns {{ revision: number, round: number, currentTurn: string,
 *   gameOver: { winner: string, reason: string } | null, you: object, opponent: object }}
 */
export function buildStateView({ game, revision, username }) {
  if (!game || typeof game.getClientState !== "function") {
    throw new TypeError("buildStateView needs a game exposing getClientState.");
  }
  if (!Number.isInteger(revision) || revision < 0) {
    throw new TypeError("revision must be a non-negative integer.");
  }
  assertNonEmptyString(username, "username");

  return { revision, ...game.getClientState(username) };
}

/**
 * Build the payload for a rejected action, decision, or connection.
 */
export function buildError(message) {
  assertNonEmptyString(message, "error message");
  return { message };
}

/**
 * Build the end-of-game payload from the engine's result.
 */
export function buildGameOverResult(gameOver) {
  if (!gameOver || typeof gameOver !== "object") {
    throw new TypeError("gameOver must be an object with winner and reason.");
  }
  assertNonEmptyString(gameOver.winner, "gameOver.winner");
  assertNonEmptyString(gameOver.reason, "gameOver.reason");

  return { winner: gameOver.winner, reason: gameOver.reason };
}

/**
 * Build the payload telling a lone player the game has not started yet.
 */
export function buildWaitingPayload() {
  return { message: WAITING_MESSAGE };
}

/**
 * Build the targeted payload for a hand-peek reveal. `peek` is the
 * `hand:peeked` event payload `{ owner, observer, cards }`; the message goes
 * to the observer's connections only.
 */
export function buildHandPeek(peek) {
  if (!peek || typeof peek !== "object") {
    throw new TypeError("peek must be an object with owner, observer, and cards.");
  }
  assertNonEmptyString(peek.owner, "peek.owner");
  assertNonEmptyString(peek.observer, "peek.observer");
  if (!Array.isArray(peek.cards)) {
    throw new TypeError("peek.cards must be an array of card views.");
  }

  return { owner: peek.owner, observer: peek.observer, cards: peek.cards.map((card) => ({ ...card })) };
}
