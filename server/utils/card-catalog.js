import Card from "../game/Card.js";
import GameState from "../game/GameState.js";
import { isTestCard } from "./test-card.js";

/**
 * Build the slug → card index over a compiled catalog. This is the deck
 * collection's conversion into the engine's runtime identifiers: stored
 * decks reference cards by slug, the engine consumes cardIds, and this index
 * is the single conversion point (see docs/DECK_COLLECTION.md).
 *
 * @param {object} cards keyed compiled catalog (`server/data/cards.json`)
 * @returns {Map<string, object>} slug → compiled card entry
 */
export function buildSlugIndex(cards) {
  return new Map(
    Object.values(cards ?? {})
      .filter((card) => typeof card?.slug === "string")
      .map((card) => [card.slug, card])
  );
}

/**
 * Project the compiled catalog into client card views. Views are built
 * through `Card.toSanitizedObject()` — the single client card-view contract —
 * so a browse page consumes exactly the shape the game sends over the wire.
 * Each view carries `deckEligible`, the engine's own deck-construction
 * eligibility, so a deck builder can mark pickable cards without re-deriving
 * the rule.
 *
 * @param {object} cards keyed compiled catalog (`server/data/cards.json`)
 * @param {{ includeTest?: boolean }} [options] include the `_Test*` cards
 * @returns {object[]} card views in catalog order
 */
export function buildCatalogViews(cards, { includeTest = false } = {}) {
  const eligible = new Set(GameState.getEligibleCardIds(cards));
  const views = [];
  for (const [key, entry] of Object.entries(cards)) {
    if (!includeTest && isTestCard(entry)) continue;
    const view = new Card(Number(key), entry, null, null).toSanitizedObject();
    view.deckEligible = eligible.has(view.cardId);
    views.push(view);
  }
  return views;
}

/**
 * Artwork files no card view claims: an artwork file is claimed when its
 * name equals the basename of a card view's `artworkPath`. Cards without
 * artwork claim nothing, so missing artwork never hides an orphan.
 *
 * @param {object[]} cardViews client card views
 * @param {string[]} artworkFileNames file names in the artworks directory
 * @returns {string[]} unclaimed file names, in the given order
 */
export function findOrphanArtworks(cardViews, artworkFileNames) {
  const claimed = new Set();
  for (const view of cardViews) {
    if (typeof view?.artworkPath !== "string" || view.artworkPath === "") continue;
    const baseName = view.artworkPath.split(/[\\/]/).pop();
    if (baseName) claimed.add(baseName);
  }
  return artworkFileNames.filter((fileName) => !claimed.has(fileName));
}
