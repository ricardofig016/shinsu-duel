/**
 * The client side of the game socket protocol.
 *
 * Mirrors the outbound event names of the server's net protocol. Client and
 * server ship together, so these constants move with the server contract.
 */
export const EVENTS = Object.freeze({
  // Outbound (client → server)
  GAME_ACTION: "game-action",
  GAME_DECISION: "game-decision",
  GAME_STATE_REQUEST: "game-state-request",

  // Inbound (server → client)
  GAME_INIT: "game-init",
  GAME_UPDATE: "game-update",
  GAME_ERROR: "game-error",
  GAME_OVER: "game-over",
  GAME_WAITING: "game-waiting",
  GAME_HAND_PEEK: "game-hand-peek",
});
