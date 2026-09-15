import { jest } from "@jest/globals";
import GameState from "../../../game/GameState.js";
import SeededRng from "../../../game/utils/SeededRng.js";
import { cards } from "../../../game/tests/fixtures/cards.js";
import RandomOwnedDeckMethod from "../../deckMethods/RandomOwnedDeckMethod.js";
import { GENERATED_DECK_ID, GENERATED_DECK_NAME } from "../../deckMethods/GeneratedDeckMethod.js";
import { validateDeckCards } from "../../../decks/deckValidation.js";

/** A legal 30-card deck of fixture-catalog slugs. */
function legalCardSlugs() {
  return GameState.getEligibleCardIds(cards)
    .map((cardId) => cards[cardId].slug)
    .slice(0, GameState.INIT_DECK_SIZE);
}

/** A deck record as the library lists it. */
const ownedDeck = (id, name, cards_ = legalCardSlugs()) => ({ id, name, cards: cards_ });
const illegalDeck = (id, name) => ownedDeck(id, name, legalCardSlugs().slice(0, GameState.INIT_DECK_SIZE - 1));

const libraryWith = (decks) => ({
  listDecks: jest.fn(async (owner) => (owner === "Alice" ? decks : [])),
});

describe("RandomOwnedDeckMethod", () => {
  const method = new RandomOwnedDeckMethod();

  test("reads the creating human's decks", async () => {
    const library = libraryWith([ownedDeck("D1", "Starter")]);
    await method.resolve({ catalog: cards, deckLibrary: library, ownerUsername: "Alice", rng: new SeededRng(1) });

    expect(library.listDecks).toHaveBeenCalledWith("Alice");
  });

  test("fields a legal owned deck with its own identity", async () => {
    const deck = ownedDeck("D1", "Tower Climb");
    const pick = await method.resolve({ catalog: cards, deckLibrary: libraryWith([deck]), ownerUsername: "Alice", rng: new SeededRng(1) });

    expect(pick).toEqual({ deckId: "D1", name: "Tower Climb", cards: deck.cards, illegal: false });
    expect(validateDeckCards(pick.cards, cards).legal).toBe(true);
  });

  test("picks uniformly among legal decks and ignores illegal ones", async () => {
    const decks = [illegalDeck("D0", "Broken"), ownedDeck("D1", "One"), ownedDeck("D2", "Two"), ownedDeck("D3", "Three")];
    const seen = new Set();
    for (let seed = 0; seed < 30; seed++) {
      const pick = await method.resolve({ catalog: cards, deckLibrary: libraryWith(decks), ownerUsername: "Alice", rng: new SeededRng(seed) });
      expect(pick.deckId).not.toBe("D0");
      expect(validateDeckCards(pick.cards, cards).legal).toBe(true);
      seen.add(pick.deckId);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  test("falls back to the generated method when no owned deck is legal", async () => {
    for (const owned of [[illegalDeck("D0", "Broken")], []]) {
      const pick = await method.resolve({ catalog: cards, deckLibrary: libraryWith(owned), ownerUsername: "Alice", rng: new SeededRng(1) });

      expect(pick.deckId).toBe(GENERATED_DECK_ID);
      expect(pick.name).toBe(GENERATED_DECK_NAME);
      expect(validateDeckCards(pick.cards, cards).legal).toBe(true);
    }
  });

  test("throws without a deck library", async () => {
    await expect(method.resolve({ catalog: cards, deckLibrary: null, ownerUsername: "Alice", rng: new SeededRng(1) })).rejects.toThrow(TypeError);
  });
});
