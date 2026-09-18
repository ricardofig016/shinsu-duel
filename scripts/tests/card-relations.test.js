import { stampRelatedCards } from "../lib/card-relations.js";
import { createLinkRegistry } from "../lib/card-link-registry.js";
import { tokenizeSegments } from "../../public/utils/card-text.js";

// Compiled card factories covering every relation edge. Cards carry the
// fields stampRelatedCards consumes: final cardId, slug, series, resolved
// evolve/ignite cross-references, and text segments on the DSL nodes whose
// references count as mentions. Every stamped entry names the tagged card's
// own relation to its peer: the card the edge was traversed from.

const registry = createLinkRegistry({
  names: ["A", "B", "C", "Wielded", "S One"],
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
  test("stamps the evolution pair on both cards, each from its own side", () => {
    const base = card({ cardId: 1, slug: "base", name: "Base" });
    const evolved = card({ cardId: 2, slug: "base_ii", name: "Base II", evolvedFrom: 1 });
    base.evolveInto = { triggers: [], cardId: 2 };
    stampRelatedCards([base, evolved]);

    expect(base.relatedCards).toEqual([{ cardId: 2, kind: "evolves-from", peerCardId: 1 }]);
    expect(evolved.relatedCards).toEqual([{ cardId: 1, kind: "evolves-into", peerCardId: 2 }]);
  });

  test("stamps the ignition pair on both cards, each from its own side", () => {
    const base = card({ cardId: 3, slug: "weapon", name: "Weapon", type: "equipment" });
    base.igniteInto = { triggers: [], cardId: 4 };
    const ignited = card({ cardId: 4, slug: "weapon_ignited", name: "Weapon - Ignited", type: "equipment", ignitedFrom: 3 });
    stampRelatedCards([base, ignited]);

    expect(base.relatedCards).toEqual([{ cardId: 4, kind: "ignited-from", peerCardId: 3 }]);
    expect(ignited.relatedCards).toEqual([{ cardId: 3, kind: "ignites-into", peerCardId: 4 }]);
  });

  test("card links in text segments become mention edges", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B" });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentions", peerCardId: 2 }]);
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

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentions", peerCardId: 2 }]);
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
      { cardId: 2, kind: "mentioned-in", peerCardId: 1 },
      { cardId: 3, kind: "mentions", peerCardId: 2 },
    ]);
    expect(c.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 3 },
      { cardId: 1, kind: "mentions", peerCardId: 2 },
    ]);
    expect(b.relatedCards).toEqual([
      { cardId: 1, kind: "mentions", peerCardId: 2 },
      { cardId: 3, kind: "mentions", peerCardId: 2 },
    ]);
  });

  test("a series reference stamps every member with the series it names, and each member sees the namer in reverse", () => {
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      passives: [passiveMentioningSeries("flame")],
    });
    const s1 = card({ cardId: 2, slug: "s1", name: "S One", type: "skill", series: "flame" });
    const s2 = card({ cardId: 3, slug: "s_two", name: "S Two", type: "skill", series: "flame" });
    stampRelatedCards([a, s1, s2]);

    // Every member is reached by the series reference itself, not one at a
    // time through the siblings of the member processed first.
    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "series-mentioned", peerCardId: 1, seriesCode: "flame" },
      { cardId: 3, kind: "series-mentioned", peerCardId: 1, seriesCode: "flame" },
    ]);
    expect(s1.relatedCards).toEqual([
      { cardId: 1, kind: "mentions", peerCardId: 2 },
      { cardId: 3, kind: "same-series-as", peerCardId: 2, seriesCode: "flame" },
    ]);
    expect(s2.relatedCards).toEqual([
      { cardId: 1, kind: "mentions", peerCardId: 3 },
      { cardId: 2, kind: "same-series-as", peerCardId: 3, seriesCode: "flame" },
    ]);
  });

  test("a member reached by name brings its own series siblings in behind it", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("s_one")] });
    const s1 = card({ cardId: 2, slug: "s_one", name: "S One", type: "skill", series: "flame" });
    const s2 = card({ cardId: 3, slug: "s_two", name: "S Two", type: "skill", series: "flame" });
    stampRelatedCards([a, s1, s2]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 1 },
      { cardId: 3, kind: "same-series-as", peerCardId: 2, seriesCode: "flame" },
    ]);
  });

  test("mentions recurse transitively until closure", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("c")] });
    const c = card({ cardId: 3, slug: "c", name: "C" });
    stampRelatedCards([a, b, c]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 1 },
      { cardId: 3, kind: "mentioned-in", peerCardId: 2 },
    ]);
    expect(b.relatedCards).toEqual([
      { cardId: 3, kind: "mentioned-in", peerCardId: 2 },
      { cardId: 1, kind: "mentions", peerCardId: 2 },
    ]);
    expect(c.relatedCards).toEqual([
      { cardId: 2, kind: "mentions", peerCardId: 3 },
      { cardId: 1, kind: "mentions", peerCardId: 2 },
    ]);
  });

  test("equipment mention chains recurse like any other edge", () => {
    const bearer = card({ cardId: 1, slug: "bearer", name: "Bearer" });
    const equip = card({ cardId: 2, slug: "equip", name: "Equip", type: "equipment", abilities: [abilityWithLink("wielded")] });
    const wielded = card({ cardId: 3, slug: "wielded", name: "Wielded" });
    stampRelatedCards([bearer, equip, wielded]);

    expect(equip.relatedCards).toEqual([{ cardId: 3, kind: "mentioned-in", peerCardId: 2 }]);
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
      { cardId: 2, kind: "mentioned-in", peerCardId: 1 },
      { cardId: 3, kind: "evolves-into", peerCardId: 2 },
      { cardId: 4, kind: "same-series-as", peerCardId: 3, seriesCode: "orbit" },
    ]);
  });

  test("cycles are safe and cards never repeat", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("a")] });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentioned-in", peerCardId: 2 }]);
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

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }]);
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

  test("test cards are outside the graph: their copy never routes a real card into a closure", () => {
    // The shipped pool carries the dev cards under data/cards/test, and the
    // served catalog filters them out. A dev card naming a card must therefore
    // not hand that card to anything else: the relation it created could not be
    // rendered (its peer is missing from the client's catalog), and it dragged
    // the named card, and everything it relates to, into a real card's row.
    const devRegistry = createLinkRegistry({ names: ["A", "F", "B"] });
    const real = card({ cardId: 1, slug: "a", name: "A" });
    const fireCore = card({ cardId: 2, slug: "f", name: "F" });
    const dev = card({
      cardId: 3,
      slug: "test_unit",
      name: "_Test Unit",
      abilities: [{ type: "deal_damage", text: tokenizeSegments("strike [[card:F]] and [[card:B]]", "test.raw", devRegistry) }],
    });
    const unrelated = card({ cardId: 4, slug: "b", name: "B" });

    // A carries shared copy naming F, which is what reaches the dev card.
    stampRelatedCards([real, fireCore, dev, unrelated], { 1: ["slug:f"] });

    expect(real.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }]);
    expect(dev.relatedCards).toBeUndefined();
    expect(unrelated.relatedCards).toBeUndefined();
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
