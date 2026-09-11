import GameState from "../game/GameState.js";
import { cards } from "../game/tests/fixtures/cards.js";
import { validateDeckCards, normalizeDeckName } from "./deckValidation.js";

const eligibleSlugs = GameState.getEligibleCardIds(cards).map((cardId) => cards[cardId].slug);
const eligibleDeck = () => eligibleSlugs.slice(0, GameState.INIT_DECK_SIZE);

function unreachableSlug() {
  return Object.values(cards).find((card) => (card.deckConstraints || []).some((c) => c.type === "unreachable")).slug;
}

// Test cards carry the `_Test` name prefix; the fixture catalog has none, so
// the rule is exercised against a catalog entry that does.
const catalogWithTestCard = {
  ...cards,
  999999: { cardId: 999999, slug: "test_dev_card", name: "_Test Dev Card", deckConstraints: [] },
};

describe("validateDeckCards", () => {
  test("accepts a legal deck", () => {
    expect(validateDeckCards(eligibleDeck(), cards)).toEqual({ buildable: true, legal: true, problems: [] });
  });

  test("accepts the maximum number of copies of a card", () => {
    const slug = eligibleSlugs[0];
    const deck = [...eligibleDeck()];
    deck[1] = slug;
    deck[2] = slug;
    const result = validateDeckCards(deck, cards);

    expect(result.legal).toBe(true);
    expect(deck.filter((card) => card === slug)).toHaveLength(GameState.MAX_CARD_COPIES);
  });

  test("flags a deck that is too short or too long", () => {
    const short = validateDeckCards(eligibleDeck().slice(0, 29), cards);
    expect(short).toMatchObject({ buildable: true, legal: false });
    expect(short.problems).toEqual([`A deck must contain exactly ${GameState.INIT_DECK_SIZE} cards; this one has 29.`]);

    const long = validateDeckCards([...eligibleDeck(), eligibleSlugs[0]], cards);
    expect(long.problems).toEqual([`A deck must contain exactly ${GameState.INIT_DECK_SIZE} cards; this one has 31.`]);
  });

  test("flags a deck above the copy limit", () => {
    const slug = eligibleSlugs[0];
    const deck = [...eligibleDeck()];
    deck[1] = slug;
    deck[2] = slug;
    deck[3] = slug;
    const result = validateDeckCards(deck, cards);

    expect(result).toMatchObject({ buildable: true, legal: false });
    expect(result.problems).toEqual([
      `"${cards[GameState.getEligibleCardIds(cards)[0]].name}" appears ${GameState.MAX_CARD_COPIES + 1} times; a deck may contain up to ${GameState.MAX_CARD_COPIES} copies of each card.`,
    ]);
  });

  test("flags Unreachable cards", () => {
    const unreachableCard = Object.values(cards).find((card) => (card.deckConstraints || []).some((c) => c.type === "unreachable"));
    const deck = [...eligibleDeck()];
    deck[0] = unreachableCard.slug;
    const result = validateDeckCards(deck, cards);

    expect(result).toMatchObject({ buildable: true, legal: false });
    expect(result.problems).toEqual([`"${unreachableCard.name}" is Unreachable and cannot be in a deck.`]);
  });

  test("flags test cards", () => {
    const deck = [...eligibleSlugs.slice(0, GameState.INIT_DECK_SIZE - 1), "test_dev_card"];
    const result = validateDeckCards(deck, catalogWithTestCard);

    expect(result).toMatchObject({ buildable: true, legal: false });
    expect(result.problems).toEqual(['"_Test Dev Card" is a test card and can only be used in dev rooms.']);
  });

  test("reports unknown card slugs as unbuildable", () => {
    const deck = [...eligibleDeck()];
    deck[0] = "not_a_card";
    const result = validateDeckCards(deck, cards);

    expect(result).toMatchObject({ buildable: false, legal: false });
    expect(result.problems).toEqual(['Card "not_a_card" does not exist.']);
  });

  test("reports a non-array card list as unbuildable", () => {
    expect(validateDeckCards("nope", cards)).toMatchObject({ buildable: false, legal: false });
    expect(validateDeckCards(null, cards).problems).toEqual(["Deck cards must be an array of card slugs."]);
  });

  test("collects every violation of one deck", () => {
    const slug = eligibleSlugs[0];
    const deck = [...eligibleSlugs.slice(0, 10), slug, slug, slug, slug, unreachableSlug()];
    const result = validateDeckCards(deck, cards);

    expect(result.buildable).toBe(true);
    expect(result.legal).toBe(false);
    expect(result.problems).toHaveLength(3);
    expect(result.problems[0]).toMatch(/exactly 30 cards; this one has 15/);
    expect(result.problems[1]).toMatch(/appears 5 times/);
    expect(result.problems[2]).toMatch(/Unreachable/);
  });
});

describe("normalizeDeckName", () => {
  test("trims a valid name", () => {
    expect(normalizeDeckName("  Tower Climb  ")).toBe("Tower Climb");
  });

  test("rejects empty, oversized, and non-string names", () => {
    expect(normalizeDeckName("")).toBeNull();
    expect(normalizeDeckName("   ")).toBeNull();
    expect(normalizeDeckName("x".repeat(41))).toBeNull();
    expect(normalizeDeckName(7)).toBeNull();
    expect(normalizeDeckName(undefined)).toBeNull();
  });
});
