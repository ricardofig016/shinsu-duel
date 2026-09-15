import GameState from "../../../game/GameState.js";
import SeededRng from "../../../game/utils/SeededRng.js";
import { cards } from "../../../game/tests/fixtures/cards.js";
import { GENERATED_DECK_ID, GENERATED_DECK_NAME } from "../../deckMethods/GeneratedDeckMethod.js";
import GeneratedDeckMethod from "../../deckMethods/GeneratedDeckMethod.js";
import { validateDeckCards } from "../../../decks/deckValidation.js";

describe("GeneratedDeckMethod", () => {
  const method = new GeneratedDeckMethod();

  test("fields a legal deck with the fixed generated identity", async () => {
    const pick = await method.resolve({ catalog: cards, rng: new SeededRng(1) });

    expect(pick.deckId).toBe(GENERATED_DECK_ID);
    expect(pick.name).toBe(GENERATED_DECK_NAME);
    expect(pick.illegal).toBe(false);
    expect(validateDeckCards(pick.cards, cards)).toEqual({ buildable: true, legal: true, problems: [] });
  });

  test("always fields exactly INIT_DECK_SIZE cards, legal across many seeds", async () => {
    for (let seed = 0; seed < 10; seed++) {
      const pick = await method.resolve({ catalog: cards, rng: new SeededRng(seed) });
      expect(pick.cards).toHaveLength(GameState.INIT_DECK_SIZE);
      expect(validateDeckCards(pick.cards, cards).legal).toBe(true);
    }
  });

  test("is deterministic per seed", async () => {
    const first = await method.resolve({ catalog: cards, rng: new SeededRng(5) });
    const second = await method.resolve({ catalog: cards, rng: new SeededRng(5) });
    expect(second.cards).toEqual(first.cards);
  });

  test("different seeds produce different decks", async () => {
    const first = await method.resolve({ catalog: cards, rng: new SeededRng(1) });
    const second = await method.resolve({ catalog: cards, rng: new SeededRng(2) });
    expect(second.cards).not.toEqual(first.cards);
  });

  test("throws without a seeded rng", async () => {
    await expect(method.resolve({ catalog: cards, rng: null })).rejects.toThrow(TypeError);
    await expect(method.resolve({ catalog: cards, rng: {} })).rejects.toThrow(TypeError);
  });

  test("throws when the catalog cannot fill a legal deck", async () => {
    const tinyCatalog = { 1: { cardId: 1, slug: "one", name: "One", deckConstraints: [] } };
    await expect(method.resolve({ catalog: tinyCatalog, rng: new SeededRng(1) })).rejects.toThrow("cannot fill a legal deck");
  });
});
