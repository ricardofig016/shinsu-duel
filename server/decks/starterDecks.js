import starterDecksData from "../data/starter-decks.json" with { type: "json" };

let loaded = null;

/**
 * The starter decks shipped with the game: curated, legal 30-card lists that
 * every account receives a copy of at creation. They reference cards by
 * **slug** (the persistent card identifier). The copies are ordinary user
 * decks that can be edited or deleted.
 *
 * Nothing reads the templates at module load, so importing the server does not
 * pull the shipped deck and card data into every suite that boots it. What the
 * templates must satisfy is enforced by `StarterDeckAudit`, which validates
 * them against the shipped catalog: a slug that no longer resolves, a card
 * that became Unreachable, or a deck that breaks the size or copy limit fails
 * that suite.
 *
 * @returns {Promise<Array<{ code: string, name: string, cards: string[] }>>}
 */
export async function loadStarterDecks() {
  loaded ??= starterDecksData.starterDecks.map((template) => ({
    code: template.code,
    name: template.name,
    cards: [...template.cards],
  }));
  return loaded;
}
