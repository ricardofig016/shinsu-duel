import cardsData from "../data/cards.json" with { type: "json" };
import { loadStarterDecks } from "./starterDecks.js";
import { validateDeckCards } from "./deckValidation.js";

/**
 * Shipped-data audit for the starter decks, in the spirit of `CardDataAudit`:
 * these decks are authored against the real catalog, so this suite validates
 * them against it. Loading is lazy, so this suite is what fails loudly when a
 * card rename or a rule change invalidates a shipped template.
 */
describe("starter decks", () => {
  let starterDecks;

  beforeAll(async () => {
    starterDecks = await loadStarterDecks();
  });

  test("ship at least two decks with unique codes and names", () => {
    expect(starterDecks.length).toBeGreaterThanOrEqual(2);
    expect(new Set(starterDecks.map((deck) => deck.code)).size).toBe(starterDecks.length);
    expect(new Set(starterDecks.map((deck) => deck.name)).size).toBe(starterDecks.length);
  });

  test("every deck is buildable and legal", () => {
    for (const deck of starterDecks) {
      const { legal, problems } = validateDeckCards(deck.cards, cardsData);
      expect({ code: deck.code, problems }).toEqual({ code: deck.code, problems: [] });
      expect(legal).toBe(true);
    }
  });

  test("every card slug resolves against the shipped catalog", () => {
    const knownSlugs = new Set(Object.values(cardsData).map((card) => card.slug));

    for (const deck of starterDecks) {
      const unknown = deck.cards.filter((slug) => !knownSlugs.has(slug));
      expect({ code: deck.code, unknown }).toEqual({ code: deck.code, unknown: [] });
    }
  });

  test("every deck holds exactly 30 cards with at most 3 copies of each", () => {
    for (const deck of starterDecks) {
      expect({ code: deck.code, length: deck.cards.length }).toEqual({ code: deck.code, length: 30 });
      const counts = new Map();
      for (const cardId of deck.cards) counts.set(cardId, (counts.get(cardId) || 0) + 1);
      expect({ code: deck.code, max: Math.max(...counts.values()) }).toEqual({ code: deck.code, max: 3 });
    }
  });
});
