import { stampRelatedCards } from "../lib/card-relations.js";
import { createLinkRegistry } from "../lib/card-link-registry.js";
import { tokenizeSegments } from "../../public/utils/card-text.js";

// Compiled card factories covering every relation edge. Cards carry the
// fields stampRelatedCards consumes: final cardId, slug, series, resolved
// evolve/ignite cross-references, and text segments on the DSL nodes whose
// references count as mentions.

const registry = createLinkRegistry({
  names: ["A", "B", "C", "Wielded"],
  series: ["Orbit", "Flame"],
});

function card(overrides = {}) {
  return {
    cardId: 0,
    slug: "",
    type: "unit",
    name: "",
    ...overrides,
  };
}

function abilityWithLink(slug) {
  return {
    type: "deal_damage",
    text: tokenizeSegments(`strike [[card:${slug}]]`, "test.raw", registry),
  };
}

function passiveMentioningCard(name) {
  return {
    type: "give_condition",
    condition: "burned",
    trigger: { type: "skill_played", cardName: name },
    text: tokenizeSegments(`${name} gives Burned 1`, "test.raw", registry),
  };
}

function passiveMentioningSeries(series) {
  return {
    type: "give_condition",
    condition: "burned",
    trigger: { type: "skill_played", series },
    text: tokenizeSegments("everything in the series", "test.raw", registry),
  };
}

describe("stampRelatedCards", () => {
  test("stamps the evolution pair on both cards", () => {
    const base = card({ cardId: 1, slug: "base", name: "Base" });
    const evolved = card({ cardId: 2, slug: "base_ii", name: "Base II", evolvedFrom: 1 });
    base.evolveInto = { triggers: [], cardId: 2 };
    stampRelatedCards([base, evolved]);

    expect(base.relatedCards).toEqual([{ cardId: 2, kind: "evolution" }]);
    expect(evolved.relatedCards).toEqual([{ cardId: 1, kind: "evolution" }]);
  });

  test("stamps the ignition pair on both cards", () => {
    const base = card({ cardId: 3, slug: "weapon", name: "Weapon", type: "equipment" });
    base.igniteInto = { triggers: [], cardId: 4 };
    const ignited = card({ cardId: 4, slug: "weapon_ignited", name: "Weapon - Ignited", type: "equipment", ignitedFrom: 3 });
    stampRelatedCards([base, ignited]);

    expect(base.relatedCards).toEqual([{ cardId: 4, kind: "ignition" }]);
    expect(ignited.relatedCards).toEqual([{ cardId: 3, kind: "ignition" }]);
  });

  test("card links in text segments become mention edges", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B" });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mention" }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentioned-by" }]);
  });

  test("machine-readable DSL references count as mentions", () => {
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      passives: [passiveMentioningCard("B")],
    });
    const b = card({ cardId: 2, slug: "b", name: "B", type: "skill" });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mention" }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentioned-by" }]);
  });

  test("singular target and source descriptors count as mentions", () => {
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      abilities: [
        { type: "deal_damage", amount: 1, target: { side: "enemy", name: "B" } },
      ],
    });
    const b = card({ cardId: 2, slug: "b", name: "B" });
    const c = card({
      cardId: 3,
      slug: "c",
      name: "C",
      passives: [
        { type: "buff", trigger: { type: "deployed", source: { side: "self", name: "B" } }, text: ["grow"] },
      ],
    });
    stampRelatedCards([a, b, c]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mention" },
      { cardId: 3, kind: "mentioned-by" },
    ]);
    expect(c.relatedCards).toEqual([
      { cardId: 2, kind: "mention" },
      { cardId: 1, kind: "mentioned-by" },
    ]);
    expect(b.relatedCards).toEqual([
      { cardId: 1, kind: "mentioned-by" },
      { cardId: 3, kind: "mentioned-by" },
    ]);
  });

  test("a series reference mentions every card in the series, and series siblings link", () => {
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      passives: [passiveMentioningSeries("flame")],
    });
    const s1 = card({ cardId: 2, slug: "s1", name: "S One", type: "skill", series: "flame" });
    const s2 = card({ cardId: 3, slug: "s_two", name: "S Two", type: "skill", series: "flame" });
    stampRelatedCards([a, s1, s2]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mention" },
      { cardId: 3, kind: "mention" },
    ]);
    // The series siblings see each other and also "mention" A in reverse.
    expect(s1.relatedCards).toEqual([
      { cardId: 1, kind: "mentioned-by" },
      { cardId: 3, kind: "series" },
    ]);
    expect(s2.relatedCards).toEqual([
      { cardId: 1, kind: "mentioned-by" },
      { cardId: 2, kind: "series" },
    ]);
  });

  test("mentions recurse transitively until closure", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("c")] });
    const c = card({ cardId: 3, slug: "c", name: "C" });
    stampRelatedCards([a, b, c]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mention" },
      { cardId: 3, kind: "mention" },
    ]);
    expect(b.relatedCards).toEqual([
      { cardId: 3, kind: "mention" },
      { cardId: 1, kind: "mentioned-by" },
    ]);
    expect(c.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-by" },
      { cardId: 1, kind: "mentioned-by" },
    ]);
  });

  test("equipment mention chains recurse like any other edge", () => {
    const bearer = card({ cardId: 1, slug: "bearer", name: "Bearer" });
    const equip = card({ cardId: 2, slug: "equip", name: "Equip", type: "equipment", abilities: [abilityWithLink("wielded")] });
    const wielded = card({ cardId: 3, slug: "wielded", name: "Wielded" });
    stampRelatedCards([bearer, equip, wielded]);

    expect(equip.relatedCards).toEqual([{ cardId: 3, kind: "mention" }]);
    expect(bearer.relatedCards).toBeUndefined();
  });

  test("relation edges chain through every kind: mention → evolution → series", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", evolvedFrom: 3 });
    const bBase = card({ cardId: 3, slug: "b_base", name: "B Base" });
    const sibling = card({ cardId: 4, slug: "sibling", name: "Sibling", series: "orbit" });
    bBase.series = "orbit";
    stampRelatedCards([a, b, bBase, sibling]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mention" },
      { cardId: 3, kind: "evolution" },
      { cardId: 4, kind: "series" },
    ]);
  });

  test("cycles are safe and cards never repeat", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("a")] });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mention" }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mention" }]);
  });

  test("the first edge kind to reach a card wins over later discoveries", () => {
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      abilities: [abilityWithLink("b")],
      passives: [passiveMentioningCard("B")],
    });
    const b = card({ cardId: 2, slug: "b", name: "B" });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mention" }]);
  });

  test("candidates are ordered by cardId within an edge kind", () => {
    const a = card({
      cardId: 9,
      slug: "a",
      name: "A",
      passives: [passiveMentioningSeries("flame")],
    });
    const sHigh = card({ cardId: 12, slug: "s_high", name: "S High", type: "skill", series: "flame" });
    const sLow = card({ cardId: 4, slug: "s_low", name: "S Low", type: "skill", series: "flame" });
    stampRelatedCards([a, sHigh, sLow]);

    expect(a.relatedCards.map((r) => r.cardId)).toEqual([4, 12]);
  });

  test("cards that relate to nothing carry no relatedCards field", () => {
    const solo = card({ cardId: 5, slug: "solo", name: "Solo" });
    stampRelatedCards([solo]);

    expect(solo.relatedCards).toBeUndefined();
  });

  test("references that resolve to no card contribute nothing", () => {
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      passives: [{
        type: "give_condition",
        trigger: { type: "skill_played", cardName: "Missing Card" },
        text: tokenizeSegments("Missing Card gives nothing", "test.raw", createLinkRegistry({ names: ["Missing Card"] })),
      }],
    });
    stampRelatedCards([a]);

    expect(a.relatedCards).toBeUndefined();
  });
});
