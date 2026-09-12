/**
 * Cache state for the game page's deck list (`GET /decks/data`).
 *
 * The list is fetched once per page, because every status broadcast would
 * otherwise re-download it. One event invalidates it: the server clears a
 * seat's pick during its start-time re-validation, which happens when the
 * picked deck was deleted, became unbuildable, or (in a normal room) became
 * illegal. The seat returns to selection, and a cached list would offer the
 * same deck with the same stale legality, so the rejection would only appear
 * after the player clicked it again.
 *
 * No DOM access here.
 */

const state = { username: null, deckId: null };

/** Start tracking a seat, at page load. */
export function beginDeckStepTracking() {
  state.username = null;
  state.deckId = null;
}

/** The seat whose pick is tracked, or null before the first status. */
export function trackedSeat() {
  return state.username;
}

/**
 * Record one `game-deck-status` payload and report whether the deck list must
 * be refetched before it is rendered.
 *
 * True only when this seat had a pick and the status no longer carries one, so
 * a page that renders the empty state still fetches once and then settles: the
 * pick stays absent, and there is nothing left to clear.
 *
 * @param {{ seats?: Array<{ username: string, deckId?: string|null }> }} status
 * @param {string|null} username the signed-in player
 * @returns {boolean}
 */
export function shouldReloadDecks(status, username) {
  const seat = status?.seats?.find((candidate) => candidate.username === username) ?? null;

  // A status for another identity (a second account in the same browser, or a
  // late status after a re-login) restarts the tracking instead of reporting a
  // transition against the previous seat's pick.
  if (username !== state.username) {
    state.username = username;
    state.deckId = seat?.deckId ?? null;
    return false;
  }

  const deckId = seat?.deckId ?? null;
  const cleared = state.deckId !== null && deckId === null;
  state.deckId = deckId;
  return cleared;
}
