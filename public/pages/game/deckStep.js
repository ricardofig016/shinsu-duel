/**
 * Pure view models for the pre-game deck-selection step on the game page.
 *
 * The server owns selectability: a normal room accepts only legal decks, a
 * dev room (`dev: true` in the selection status) accepts anything buildable.
 * These helpers shape what the page renders — the seat progress carried by
 * `game-deck-status` and the picker options built from `GET /decks/data` —
 * and never re-derive the deck rules. No DOM access here.
 */

/**
 * Picker options for the game page's deck list.
 *
 * @param {Array<{ id: string, name: string, cards: string[], legal: boolean, problems?: string[] }>} decks
 *   the caller's own decks, as served by `GET /decks/data`
 * @param {{ dev?: boolean }} [options] dev-room flag from the selection status
 * @returns {Array<{ id: string, name: string, size: number, legal: boolean,
 *   problems: string[], selectable: boolean, warning: boolean }>}
 */
export function buildDeckOptions(decks, { dev = false } = {}) {
  return (decks ?? []).map((deck) => {
    const legal = Boolean(deck.legal);
    return {
      id: deck.id,
      name: deck.name,
      size: Array.isArray(deck.cards) ? deck.cards.length : 0,
      legal,
      problems: [...(deck.problems ?? [])],
      // In a normal room only legal decks are selectable; a dev room accepts
      // anything buildable, so illegal decks stay selectable behind a warning.
      selectable: legal || dev,
      warning: dev && !legal,
    };
  });
}

/**
 * @param {{ dev?: boolean, seats?: Array<object> }} status the selection status
 * @param {string} username the seat to find
 * @returns {object|null} the seat's progress entry, or null
 */
export function findSeat(status, username) {
  return status?.seats?.find((seat) => seat.username === username) ?? null;
}

/**
 * The full view model for the deck-selection step.
 *
 * @param {object} args
 * @param {{ dev?: boolean, seats?: Array<object> }} args.status the current
 *   `game-deck-status` payload
 * @param {Array<object>} args.decks the caller's decks from `GET /decks/data`
 * @param {string|null} args.username the signed-in player's username
 * @returns {object|null} null when there is no status yet
 */
export function buildDeckStepViewModel({ status, decks, username }) {
  if (!status) return null;
  const dev = Boolean(status.dev);
  const mine = findSeat(status, username);
  const opponent = status.seats?.find((seat) => seat.username !== username) ?? null;
  return {
    dev,
    options: buildDeckOptions(decks, { dev }),
    mySeat: mine,
    // The id of the seat's own pick, so the page can mark it in the list.
    myDeckId: mine?.deckId ?? null,
    opponentSeat: opponent,
    everySeatChosen: (status.seats ?? []).length > 0 && (status.seats ?? []).every((seat) => seat.deckChosen),
  };
}
