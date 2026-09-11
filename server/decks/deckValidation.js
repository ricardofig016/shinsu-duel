import GameState from "../game/GameState.js";
import { isTestCard } from "../utils/test-card.js";

/**
 * Deck validation — the collection-side view of the deck-construction
 * contract. The engine enforces the same rules when a game is built; this
 * module reports them so a stored deck can be saved with violations and
 * flagged, and so a room can decide whether the deck may start a game.
 *
 * Decks reference cards by **slug** (`normalizeName(name)`, stamped into the
 * compiled catalog): the slug is a card's persistent identifier, while the
 * runtime cardId is a name-sorted compile-time index that shifts whenever the
 * catalog changes.
 *
 * Two tiers:
 *  - buildable: every slug resolves in the catalog, so the engine can
 *    construct the cards at all.
 *  - legal: buildable, exactly `INIT_DECK_SIZE` cards, at most
 *    `MAX_CARD_COPIES` copies of each card, no Unreachable cards, and no
 *    test cards.
 */

const MAX_DECK_NAME_LENGTH = 40;

/** The rejection message for an invalid deck name, worded from the limit. */
export const DECK_NAME_PROBLEM = `Deck name must be 1-${MAX_DECK_NAME_LENGTH} characters.`;

/**
 * Rules shared with the engine are read from `GameState`, never copied.
 * @param {Array<string>} cardSlugs
 * @param {object} catalog compiled card catalog keyed by card id, entries carrying `slug`
 * @returns {{ buildable: boolean, legal: boolean, problems: string[] }}
 */
export function validateDeckCards(cardSlugs, catalog) {
  if (!Array.isArray(cardSlugs)) {
    return { buildable: false, legal: false, problems: ["Deck cards must be an array of card slugs."] };
  }

  const bySlug = new Map(Object.values(catalog ?? {}).map((card) => [card.slug, card]));
  const eligibleSlugs = new Set(
    GameState.getEligibleCardIds(catalog)
      .map((cardId) => catalog?.[cardId]?.slug)
      .filter(Boolean)
  );

  const unknown = new Set();
  const copies = new Map();
  const unreachable = new Set();
  const testCards = new Set();

  for (const slug of cardSlugs) {
    const cardData = bySlug.get(slug);
    if (cardData === undefined) {
      unknown.add(slug);
      continue;
    }
    copies.set(slug, (copies.get(slug) || 0) + 1);
    if (!eligibleSlugs.has(slug)) unreachable.add(slug);
    if (isTestCard(cardData)) testCards.add(slug);
  }

  const buildable = unknown.size === 0;
  const problems = [...unknown].map((slug) => `Card "${slug}" does not exist.`);

  if (buildable) {
    if (cardSlugs.length !== GameState.INIT_DECK_SIZE) {
      problems.push(`A deck must contain exactly ${GameState.INIT_DECK_SIZE} cards; this one has ${cardSlugs.length}.`);
    }
    for (const [slug, count] of copies) {
      if (count > GameState.MAX_CARD_COPIES) {
        problems.push(
          `"${bySlug.get(slug).name}" appears ${count} times; a deck may contain up to ${GameState.MAX_CARD_COPIES} copies of each card.`
        );
      }
    }
    for (const slug of unreachable) {
      problems.push(`"${bySlug.get(slug).name}" is Unreachable and cannot be in a deck.`);
    }
    for (const slug of testCards) {
      problems.push(`"${bySlug.get(slug).name}" is a test card and can only be used in dev rooms.`);
    }
  }

  return { buildable, legal: buildable && problems.length === 0, problems };
}

/**
 * The deck-construction numbers a client displays or caps input with. Clients
 * read these from the deck API rather than restating the rules, which live in
 * `GameState` and RULES.md.
 * @returns {{ deckSize: number, maxCardCopies: number, maxNameLength: number }}
 */
export function deckLimits() {
  return {
    deckSize: GameState.INIT_DECK_SIZE,
    maxCardCopies: GameState.MAX_CARD_COPIES,
    maxNameLength: MAX_DECK_NAME_LENGTH,
  };
}

/**
 * A deck name must be a non-empty string of at most
 * `MAX_DECK_NAME_LENGTH` characters.
 * @param {*} name
 * @returns {string|null} the trimmed name, or null when invalid
 */
export function normalizeDeckName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_DECK_NAME_LENGTH) return null;
  return trimmed;
}
