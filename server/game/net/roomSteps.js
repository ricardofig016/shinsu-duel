import path from "node:path";

/**
 * The three steps of a room before the board, and what each one serves.
 *
 * A room's step is derived from the room record and the session registry: no
 * session means the second player has never connected, an unstarted session
 * means both players are choosing decks, and a started session means the game
 * is running. Every room URL resolves to the step the room is actually in, so
 * the address a player keeps or shares always lands them where the room is,
 * and the client mirrors this table in `public/game/steps.js`.
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

/** The document each step serves, relative to the project root. */
export const STEP_DOCUMENTS = Object.freeze({
  [STEP.WAITING]: "public/pages/game/waiting/index.html",
  [STEP.DECK]: "public/pages/game/deck/index.html",
  [STEP.BOARD]: "public/pages/game/index.html",
});

/** The page a rejected visitor gets: no such room, or no seat left in it. */
export const DENIED_DOCUMENT = "public/pages/game/denied.html";

/**
 * The step a room is in.
 *
 * @param {{ session: object|null|undefined }} args the room's session from the
 *   registry, or null when the room has none
 * @returns {"waiting"|"deck"|"board"}
 */
export function roomStep({ session }) {
  if (!session) return STEP.WAITING;
  return session.isStarted ? STEP.BOARD : STEP.DECK;
}

/** The room address for one of its steps. */
export function stepPath(roomCode, step) {
  if (!Object.values(STEP).includes(step)) throw new TypeError(`Unknown room step "${step}".`);
  return `/game/${encodeURIComponent(roomCode)}${STEP_PATHS[step]}`;
}

/** The absolute path of the document a step serves. */
export function stepDocument(step) {
  if (!Object.values(STEP).includes(step)) throw new TypeError(`Unknown room step "${step}".`);
  return path.resolve(STEP_DOCUMENTS[step]);
}

/** The absolute path of the page a rejected visitor gets. */
export function deniedDocument() {
  return path.resolve(DENIED_DOCUMENT);
}
