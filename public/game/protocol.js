/**
 * Client side of the game socket protocol.
 *
 * Mirrors the outbound event names of the server's net protocol. Client and
 * server ship together, so these constants move with the server contract.
 */
export const EVENTS = Object.freeze({
  // Outbound (client → server)
  GAME_ACTION: "game-action",
  GAME_DECISION: "game-decision",
  GAME_STATE_REQUEST: "game-state-request",
  GAME_DECK_SELECT: "game-deck-select",
  GAME_DEBUG_ACTION: "debug-action",
  GAME_DEBUG_QUERY: "debug-query",
  GAME_DEBUG_FIREHOSE: "debug-firehose",
  GAME_DEBUG_RESTART: "debug-restart",

  // Inbound (server → client)
  GAME_INIT: "game-init",
  GAME_UPDATE: "game-update",
  GAME_ERROR: "game-error",
  GAME_OVER: "game-over",
  GAME_WAITING: "game-waiting",
  GAME_HAND_PEEK: "game-hand-peek",
  GAME_DECK_STATUS: "game-deck-status",
  GAME_DEBUG_RESULT: "debug-result",
  GAME_DEBUG_EVENT: "debug-event",
});

/**
 * Reasons a rejection can carry, mirroring the server's codes. The client
 * branches on these instead of on message text.
 */
export const ERROR_CODES = Object.freeze({
  UNAUTHENTICATED: "unauthenticated",
});
