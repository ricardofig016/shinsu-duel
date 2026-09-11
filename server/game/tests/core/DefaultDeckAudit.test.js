import { createSeededGame } from "../../gameFactory.js";
import cardsData from "../../../data/cards.json" with { type: "json" };
import { validateDeckCards } from "../../../decks/deckValidation.js";

/**
 * Shipped-data audit for the default decks the production factory deals when
 * a room carries no deck picks: every seed must produce decks that satisfy
 * the deck legality contract, test cards included.
 */
function fullDeck(playerState) {
  return [...playerState.deck, ...[...playerState.hand].reverse()].map((card) => card.slug);
}

describe("shipped default decks", () => {
  test("every seed produces decks that satisfy the deck legality contract", () => {
    for (const seed of [0, 1, 7, 42, 1234, 99991]) {
      const game = createSeededGame({ roomCode: "AUDIT", usernames: ["Alice", "Bob"], seed, cards: cardsData });
      for (const username of ["Alice", "Bob"]) {
        const deck = fullDeck(game.playerStates[username]);
        const { legal, problems } = validateDeckCards(deck, cardsData);
        expect({ seed, username, problems }).toEqual({ seed, username, problems: [] });
        expect(legal).toBe(true);
      }
    }
  });
});
