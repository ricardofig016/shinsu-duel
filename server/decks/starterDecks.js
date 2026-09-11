import starterDecksData from "../data/starter-decks.json" with { type: "json" };
import cardsData from "../data/cards.json" with { type: "json" };

const knownSlugs = new Set(Object.values(cardsData).map((card) => card.slug));

/**
 * The starter decks shipped with the game: curated, legal 30-card lists that
 * every account receives a copy of at creation. They reference cards by
 * **slug** (the persistent card identifier) and fail loudly at load when a
 * slug no longer resolves, as after a card rename. The copies are ordinary
 * user decks that can be edited or deleted.
 */
export const starterDecks = starterDecksData.starterDecks.map((template) => {
  for (const slug of template.cards) {
    if (!knownSlugs.has(slug)) {
      throw new Error(`Starter deck "${template.code}" references unknown card slug "${slug}".`);
    }
  }
  return { code: template.code, name: template.name, cards: [...template.cards] };
});
