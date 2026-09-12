/**
 * The shared dev-room check.
 *
 * A dev room is any room whose code is "TESTROOM" followed by digits. This
 * one predicate decides every dev-room behavior: live game logging, relaxed
 * deck selection, and relaxed engine deck enforcement. Everything that needs
 * the notion imports it from here; no other module may hardcode the pattern.
 */

/** The only dev-room code pattern: "TESTROOM" followed by digits. */
export const DEV_ROOM_CODE_PATTERN = /^TESTROOM\d+$/;

/**
 * Whether a room code names a dev room.
 *
 * @param {string} roomCode
 * @returns {boolean}
 */
export function isDevRoomCode(roomCode) {
  return typeof roomCode === "string" && DEV_ROOM_CODE_PATTERN.test(roomCode);
}
