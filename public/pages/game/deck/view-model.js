/**
 * Pure view models for the pre-game deck step. No DOM access here.
 *
 * The server owns selectability — a normal room accepts only legal decks, a
 * dev room accepts anything buildable — and it owns what each seat may know:
 * the selection status carries the caller's own deck identity and, for the
 * opponent, only whether a pick exists and whether they are connected.
 */

import { DECK_TABLE_COLUMNS, DEFAULT_DECK_LIMITS, buildDeckTableRow } from "../../../utils/deck-model.js";

/** How long the versus reveal stays up before the board takes over. */
export const VERSUS_BEAT_MS = 1000;

/**
 * The columns this step's table shows: the deck list's columns without the two
 * a collection needs and a match does not (when it was last updated, and the
 * row actions a click replaces).
 */
export const SELECTION_COLUMNS = Object.freeze(
  DECK_TABLE_COLUMNS.filter((column) => !["updatedAt", "actions"].includes(column.key))
);

/**
 * One row of the deck step's table: the deck-list row plus whether this seat
 * may lock it in. A deck the engine cannot build is never selectable, not even
 * in a dev room, because no room can start a game with it.
 *
 * @param {Array<object>} decks the caller's decks from `GET /decks/data`
 * @param {{ entriesBySlug?: Map<string, object>, limits?: object, dev?: boolean }} [options]
 */
export function buildSelectionRows(decks, { entriesBySlug = null, limits = DEFAULT_DECK_LIMITS, dev = false } = {}) {
  return (decks ?? []).map((deck) => {
    const row = buildDeckTableRow(deck, { entriesBySlug, limits });
    return { ...row, deck: deck ?? null, selectable: row.isBuildable && (row.isLegal || dev) };
  });
}

/**
 * What the page says about the other seat. The opponent's deck is never named
 * before the game starts, so this only ever reports presence and readiness.
 * A bot seat fields no deck pick of its own — its deck method resolves one at
 * game start — so it reads as ready the moment the session exists, named so
 * the player knows who they face.
 * @param {{ connected?: boolean, deckChosen?: boolean, bot?: boolean, username?: string }|null} seat
 */
export function buildOpponentLine(seat) {
  if (!seat) return "Waiting for the opponent to connect.";
  if (!seat.connected) return "Opponent is not connected.";
  if (seat.bot) return `${seat.username} is ready.`;
  return seat.deckChosen ? "Opponent is ready." : "Opponent is still choosing.";
}

/**
 * The full view model of the deck step.
 *
 * @param {object} args
 * @param {object} args.status the current `game-deck-status` payload
 * @param {Array<object>} args.decks the caller's decks from `GET /decks/data`
 * @param {string|null} args.username the signed-in player
 * @param {Map<string, object>|null} args.entriesBySlug pool entries by slug
 * @param {object} [args.limits] the deck-construction limits
 * @returns {object|null} null when there is no status yet
 */
export function buildDeckStepView({ status, decks, username, entriesBySlug = null, limits = DEFAULT_DECK_LIMITS }) {
  if (!status) return null;
  const seats = status.seats ?? [];
  const mine = seats.find((seat) => seat.username === username) ?? null;
  const opponent = seats.find((seat) => seat.username !== username) ?? null;
  const dev = Boolean(status.dev);

  return {
    dev,
    rows: buildSelectionRows(decks, { entriesBySlug, limits, dev }),
    mySeat: mine,
    opponentSeat: opponent,
    opponentLine: buildOpponentLine(opponent),
    lockedDeckId: mine?.deckChosen ? mine.deckId : null,
  };
}

/**
 * Whether a status means the deck list the page holds is stale: the server
 * clears a pick it no longer accepts (the deck was deleted, stopped being
 * buildable, or became illegal in a normal room), and the list is what shows
 * the seat why.
 *
 * @param {object|null} previous the status the page rendered last
 * @param {object|null} next the status that just arrived
 * @param {string|null} username
 */
export function pickCleared(previous, next, username) {
  const before = previous?.seats?.find((seat) => seat.username === username) ?? null;
  const after = next?.seats?.find((seat) => seat.username === username) ?? null;
  return Boolean(before?.deckChosen) && Boolean(after) && !after.deckChosen;
}

/**
 * The versus reveal: each seat's deck name and the pool entries of its fan.
 * The payload carries fan slugs, so a slug the loaded catalog does not know
 * simply does not appear.
 *
 * @param {{ seats?: Array<{ username: string, deckName: string, fan: string[] }> }} reveal
 * @param {Map<string, object>|null} entriesBySlug
 */
export function buildVersusView(reveal, entriesBySlug) {
  return {
    seats: (reveal?.seats ?? []).map((seat) => ({
      username: seat.username,
      deckName: seat.deckName,
      fan: (seat.fan ?? []).map((slug) => entriesBySlug?.get(slug) ?? null).filter(Boolean),
    })),
  };
}
