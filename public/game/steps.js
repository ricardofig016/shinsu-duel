import { EVENTS } from "./protocol.js";

/**
 * The steps of a room and the address each one lives at, mirrored from the
 * server's `server/game/net/roomSteps.js` (the two tables are compared in
 * `server/game/tests/net/roomSteps.test.js`).
 *
 * A room is in exactly one step, and every room address serves the step the
 * room is in: a page that learns the room has moved on hands the browser to
 * the address of the step it moved to. Nothing here reads the DOM, so the
 * mapping is testable in Node.
 */

export const STEP = Object.freeze({
  WAITING: "waiting",
  DECK: "deck",
  BOARD: "board",
});

/** URL suffix of each step; the board keeps the bare room address. */
export const STEP_PATHS = Object.freeze({
  [STEP.WAITING]: "/waiting",
  [STEP.DECK]: "/deck",
  [STEP.BOARD]: "",
});

/** The room address for one of its steps. */
export function stepPath(roomCode, step) {
  if (!Object.values(STEP).includes(step)) throw new TypeError(`Unknown room step "${step}".`);
  return `/game/${encodeURIComponent(roomCode)}${STEP_PATHS[step]}`;
}

/** The bare room address: the one a player types or shares to join. */
export function roomPath(roomCode) {
  return stepPath(roomCode, STEP.BOARD);
}

/**
 * The room code in a room URL, or null when the path is not a room address.
 * @param {string} pathname
 */
export function roomCodeFromPath(pathname) {
  const segments = String(pathname ?? "").split("/").filter((segment) => segment !== "");
  if (segments.length < 2 || segments[0] !== "game" || segments.length > 3) return null;
  return segments[1] ?? null;
}

/**
 * The step a room URL names, or null when the path is not a room address.
 * The bare room address is the board.
 * @param {string} pathname
 */
export function stepFromPath(pathname) {
  const segments = String(pathname ?? "").split("/").filter((segment) => segment !== "");
  if (segments.length < 2 || segments[0] !== "game" || segments.length > 3) return null;
  if (segments.length === 2) return STEP.BOARD;
  return Object.values(STEP).includes(segments[2]) ? segments[2] : null;
}

/**
 * The step a server message puts the room in, or null for a message that
 * carries no step. Every message a connection receives on connect names one:
 * the waiting message, the selection progress, or the first state view.
 * @param {string} event one of the protocol's inbound event names
 */
export function stepForEvent(event) {
  if (event === EVENTS.GAME_WAITING) return STEP.WAITING;
  if (event === EVENTS.GAME_DECK_STATUS) return STEP.DECK;
  if (event === EVENTS.GAME_INIT) return STEP.BOARD;
  return null;
}

/** Send the browser to a step's address, replacing the current history entry. */
export function goToStep(roomCode, step) {
  window.location.replace(stepPath(roomCode, step));
}

/** The inbound messages that name the room's step. */
export const STEP_EVENTS = Object.freeze([EVENTS.GAME_WAITING, EVENTS.GAME_DECK_STATUS, EVENTS.GAME_INIT]);

/**
 * Follow the room's step on a connection: whenever a message names a step the
 * page does not render, the browser is handed to that step's address. A page
 * keeps its own step's events (`ignore`) when it needs their payload.
 *
 * @param {{ on: (event: string, handler: Function) => void }} socket
 * @param {string} roomCode
 * @param {string} ownStep the step this page renders
 * @param {{ ignore?: string[] }} [options] step events the page handles itself
 */
export function followRoomStep(socket, roomCode, ownStep, { ignore = [] } = {}) {
  for (const event of STEP_EVENTS) {
    if (ignore.includes(event)) continue;
    socket.on(event, () => {
      const step = stepForEvent(event);
      if (step !== null && step !== ownStep) goToStep(roomCode, step);
    });
  }
}
