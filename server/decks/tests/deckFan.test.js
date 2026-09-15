import { cards } from "../../game/tests/fixtures/cards.js";
import { buildDeckFanSlugs } from "../deckFan.js";
import { buildDeckFan } from "../../../public/utils/deck-model.js";

const bySlug = new Map(Object.values(cards).map((card) => [card.slug, card]));
const entriesBySlug = new Map(
  Object.values(cards).map((card) => [
    card.slug,
    { slug: card.slug, name: card.name, view: { type: card.type, cost: card.cost } },
  ])
);

const unitSlugs = Object.values(cards)
  .filter((card) => card.type === "unit")
  .map((card) => card.slug);
const nonUnitSlugs = Object.values(cards)
  .filter((card) => card.type !== "unit")
  .map((card) => card.slug);

describe("buildDeckFanSlugs", () => {
  test("returns the most expensive distinct units, cheapest first", () => {
    const fan = buildDeckFanSlugs(unitSlugs, cards);

    expect(fan).toHaveLength(3);
    const costs = fan.map((slug) => bySlug.get(slug).cost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
    expect(new Set(fan).size).toBe(3);
    expect(fan.every((slug) => bySlug.get(slug).type === "unit")).toBe(true);
  });

  test("never repeats a card the deck holds several copies of", () => {
    const cheapest = unitSlugs.reduce((lowest, slug) =>
      bySlug.get(slug).cost < bySlug.get(lowest).cost ? slug : lowest
    );
    const deck = [cheapest, cheapest, cheapest];
    expect(buildDeckFanSlugs(deck, cards)).toEqual([cheapest]);
  });

  test("ignores skills, equipment, and slugs the catalog does not know", () => {
    const fan = buildDeckFanSlugs([...nonUnitSlugs, "not_a_card"], cards);
    expect(fan).toEqual([]);
  });

  test("a deck with fewer than three distinct units shows the ones it has", () => {
    expect(buildDeckFanSlugs([], cards)).toEqual([]);
    expect(buildDeckFanSlugs([unitSlugs[0]], cards)).toEqual([unitSlugs[0]]);
  });

  test("the limit bounds the fan", () => {
    expect(buildDeckFanSlugs(unitSlugs, cards, { limit: 1 })).toHaveLength(1);
    expect(buildDeckFanSlugs(unitSlugs, cards, { limit: 0 })).toEqual([]);
  });

  test("agrees with the client's fan rule on the same catalog", () => {
    for (const deck of [unitSlugs, [...unitSlugs, ...nonUnitSlugs], [], [unitSlugs[1], unitSlugs[0]]]) {
      const serverFan = buildDeckFanSlugs(deck, cards);
      const clientFan = buildDeckFan(deck, entriesBySlug).map((entry) => entry.slug);
      expect(serverFan).toEqual(clientFan);
    }
  });
});
