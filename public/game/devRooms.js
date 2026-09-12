/**
 * Client side of the dev-room check, mirrored from the server's
 * `server/game/devRooms.js` (see `devRooms.test.js`).
 *
 * The waiting step has no server message yet, so the dev-room notice it shows
 * cannot come from the wire: it reads the room code the way the server does.
 * The deck step takes the server's own `dev` flag instead.
 */

/** The only dev-room code pattern: "TESTROOM" followed by digits. */
export const DEV_ROOM_CODE_PATTERN = /^TESTROOM\d+$/;

/**
 * Whether a room code names a dev room.
 * @param {string} roomCode
 * @returns {boolean}
 */
export function isDevRoomCode(roomCode) {
  return typeof roomCode === "string" && DEV_ROOM_CODE_PATTERN.test(roomCode);
}
