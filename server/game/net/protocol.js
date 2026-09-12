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
  GAME_DECK_SELECT: "game-deck-select",
  GAME_DEBUG_ACTION: "debug-action",
  GAME_DEBUG_QUERY: "debug-query",
  GAME_DEBUG_FIREHOSE: "debug-firehose",
  GAME_DEBUG_RESTART: "debug-restart",

  // Outbound (server → client)
  GAME_INIT: "game-init",
  GAME_UPDATE: "game-update",
  GAME_ERROR: "game-error",
  GAME_OVER: "game-over",
  GAME_WAITING: "game-waiting",
  GAME_HAND_PEEK: "game-hand-peek",
  GAME_DECK_STATUS: "game-deck-status",
  GAME_DEBUG_RESULT: "debug-result",
  GAME_DEBUG_EVENT: "debug-event",
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

/**
 * Reasons a rejection can carry. A payload omits `code` when the client has
 * nothing to branch on; an identity failure is the case that needs one.
 */
export const ERROR_CODES = Object.freeze({
  UNAUTHENTICATED: "unauthenticated",
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
 * Build the payload for a rejected action, decision, or connection. `code` is
 * optional and must come from `ERROR_CODES`, so a client can act on the reason
 * instead of on the message text.
 */
export function buildError(message, code = null) {
  assertNonEmptyString(message, "error message");
  if (code === null) return { message };
  if (!Object.values(ERROR_CODES).includes(code)) {
    throw new TypeError(`Unknown error code "${code}".`);
  }
  return { message, code };
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

/**
 * Build the inbound pre-game deck-selection payload. `deckId` is the id of
 * one of the sender's own decks in the deck collection.
 */
export function buildDeckSelect({ deckId }) {
  assertNonEmptyString(deckId, "deckId");
  return { deckId };
}

/**
 * Build the per-seat deck-selection progress payload broadcast during the
 * pre-game selection phase.
 *
 * @param {object} args
 * @param {boolean} args.dev whether the room is a dev room (illegal decks
 *   are selectable there, so the client shows a warning instead of disabling)
 * @param {Array<{ username: string, deckChosen: boolean, deckId: string|null,
 *   deckName: string|null, illegal: boolean }>} args.seats one entry per seat,
 *   in seat order; the id lets each seat recognize its own pick
 */
export function buildDeckStatus({ dev, seats }) {
  if (typeof dev !== "boolean") {
    throw new TypeError("dev must be a boolean.");
  }
  if (!Array.isArray(seats) || seats.length === 0) {
    throw new TypeError("seats must be a non-empty array of seat entries.");
  }

  return {
    dev,
    seats: seats.map((seat) => {
      if (!seat || typeof seat !== "object") {
        throw new TypeError("each seat entry must be an object.");
      }
      assertNonEmptyString(seat.username, "seat.username");
      if (typeof seat.deckChosen !== "boolean") {
        throw new TypeError("seat.deckChosen must be a boolean.");
      }
      if (seat.deckChosen) {
        assertNonEmptyString(seat.deckId, "seat.deckId");
        assertNonEmptyString(seat.deckName, "seat.deckName");
      } else if (seat.deckId !== null || seat.deckName !== null) {
        throw new TypeError("seat.deckId and seat.deckName must be null when no deck is chosen.");
      }
      if (typeof seat.illegal !== "boolean") {
        throw new TypeError("seat.illegal must be a boolean.");
      }

      return {
        username: seat.username,
        deckChosen: seat.deckChosen,
        deckId: seat.deckId,
        deckName: seat.deckName,
        illegal: seat.illegal,
      };
    }),
  };
}

/**
 * Scalar payload fields a debug event line carries. Engine payloads hold live
 * objects (units, cards, player states) that alias game state and are not
 * JSON-safe: `Unit.card.bus` closes a cycle back to the event bus. A line
 * therefore carries only the scalars and scalar arrays, which is enough to
 * follow an event chain in the console.
 */
function compactFields(payload) {
  const isScalar = (value) =>
    value === null || ["string", "number", "boolean"].includes(typeof value);
  const fields = {};
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return fields;

  for (const [key, value] of Object.entries(payload)) {
    if (isScalar(value)) fields[key] = value;
    else if (Array.isArray(value) && value.every(isScalar)) fields[key] = [...value];
  }
  return fields;
}

/**
 * Build one line of the dev-room event firehose: the stream's own sequence
 * number, the root event's name, and its scalar payload fields. The firehose
 * is a diagnostic stream in the net layer, never recorded and never part of
 * the replay artifact.
 */
export function buildDebugEvent({ sequence, eventName, payload }) {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new TypeError("sequence must be a positive integer.");
  }
  assertNonEmptyString(eventName, "eventName");

  return { sequence, name: eventName, fields: compactFields(payload) };
}

/**
 * Build the answer to one dev-console query. `data` is the query's own
 * product, shaped by the query itself; `requestId` is echoed so the console
 * can resolve the matching promise. Rejections never use this payload: a
 * refused query is answered with `game-error`, like every other rejection.
 */
export function buildDebugResult({ requestId, kind, data }) {
  assertNonEmptyString(requestId, "requestId");
  assertNonEmptyString(kind, "kind");
  if (!data || typeof data !== "object") {
    throw new TypeError("data must be the query's result object.");
  }

  return { requestId, kind, data };
}
