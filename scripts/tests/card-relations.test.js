import { stampRelatedCards } from "../lib/card-relations.js";
import { createLinkRegistry } from "../lib/card-link-registry.js";
import { tokenizeSegments } from "../../public/utils/card-text.js";

// Compiled card factories covering every relation edge. Cards carry the
// fields stampRelatedCards consumes: final cardId, slug, series, resolved
// evolve/ignite cross-references, and text segments on the DSL nodes whose
// references count as mentions. Every stamped entry names the tagged card's
// own relation to its peer: the card the edge was traversed from.

const registry = createLinkRegistry({
  names: ["A", "B", "C", "Wielded", "S One", "Named", "Focus"],
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
    // Each side's own copy names the other: the earlier stage's evolve block
    // names the later one, and the later one's evolve block names the earlier.
    const base = card({ cardId: 1, slug: "base", name: "Base" });
    const evolved = card({ cardId: 2, slug: "base_ii", name: "Base II", evolvedFrom: 1 });
    base.evolveInto = { triggers: [], cardId: 2 };
    evolved.evolveInto = { triggers: [], cardId: 1 };
    stampRelatedCards([base, evolved]);

    expect(base.relatedCards).toEqual([{ cardId: 2, kind: "evolves-from", peerCardId: 1, tier: "primary" }]);
    expect(evolved.relatedCards).toEqual([{ cardId: 1, kind: "evolves-into", peerCardId: 2, tier: "primary" }]);
  });

  test("stamps the ignition pair on both cards, each from its own side", () => {
    const base = card({ cardId: 3, slug: "weapon", name: "Weapon", type: "equipment" });
    base.igniteInto = { triggers: [], cardId: 4 };
    const ignited = card({ cardId: 4, slug: "weapon_ignited", name: "Weapon - Ignited", type: "equipment", ignitedFrom: 3 });
    ignited.igniteInto = { triggers: [], cardId: 3 };
    stampRelatedCards([base, ignited]);

    expect(base.relatedCards).toEqual([{ cardId: 4, kind: "ignited-from", peerCardId: 3, tier: "primary" }]);
    expect(ignited.relatedCards).toEqual([{ cardId: 3, kind: "ignites-into", peerCardId: 4, tier: "primary" }]);
  });

  test("card links in text segments become mention edges", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B" });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" }]);
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

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" }]);
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
      { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 3, kind: "mentions", peerCardId: 2, tier: "secondary" },
    ]);
    expect(c.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 3, tier: "primary" },
      { cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" },
    ]);
    expect(b.relatedCards).toEqual([
      // Nothing here is B's own edge: both entries are cards that name B.
      { cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" },
      { cardId: 3, kind: "mentions", peerCardId: 2, tier: "secondary" },
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
      { cardId: 2, kind: "series-mentioned", peerCardId: 1, seriesCode: "flame", tier: "primary" },
      { cardId: 3, kind: "series-mentioned", peerCardId: 1, seriesCode: "flame", tier: "primary" },
    ]);
    expect(s1.relatedCards).toEqual([
      { cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" },
      { cardId: 3, kind: "same-series-as", peerCardId: 2, seriesCode: "flame", tier: "secondary" },
    ]);
    expect(s2.relatedCards).toEqual([
      { cardId: 1, kind: "mentions", peerCardId: 3, tier: "secondary" },
      { cardId: 2, kind: "same-series-as", peerCardId: 3, seriesCode: "flame", tier: "secondary" },
    ]);
  });

  test("a member reached by name brings its own series siblings in behind it", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("s_one")] });
    const s1 = card({ cardId: 2, slug: "s_one", name: "S One", type: "skill", series: "flame" });
    const s2 = card({ cardId: 3, slug: "s_two", name: "S Two", type: "skill", series: "flame" });
    stampRelatedCards([a, s1, s2]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 3, kind: "same-series-as", peerCardId: 2, seriesCode: "flame", tier: "secondary" },
    ]);
  });

  test("mentions recurse transitively until closure", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("c")] });
    const c = card({ cardId: 3, slug: "c", name: "C" });
    stampRelatedCards([a, b, c]);

    // A names B and B names C, so A's own copy reaches both: primary is the
    // whole forward walk, not just the first step.
    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 3, kind: "mentioned-in", peerCardId: 2, tier: "primary" },
    ]);
    expect(b.relatedCards).toEqual([
      { cardId: 3, kind: "mentioned-in", peerCardId: 2, tier: "primary" },
      { cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" },
    ]);
    expect(c.relatedCards).toEqual([
      { cardId: 2, kind: "mentions", peerCardId: 3, tier: "secondary" },
      { cardId: 1, kind: "mentions", peerCardId: 2, tier: "secondary" },
    ]);
  });

  test("equipment mention chains recurse like any other edge", () => {
    const bearer = card({ cardId: 1, slug: "bearer", name: "Bearer" });
    const equip = card({ cardId: 2, slug: "equip", name: "Equip", type: "equipment", abilities: [abilityWithLink("wielded")] });
    const wielded = card({ cardId: 3, slug: "wielded", name: "Wielded" });
    stampRelatedCards([bearer, equip, wielded]);

    expect(equip.relatedCards).toEqual([{ cardId: 3, kind: "mentioned-in", peerCardId: 2, tier: "primary" }]);
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
      { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 3, kind: "evolves-into", peerCardId: 2, tier: "secondary" },
      { cardId: 4, kind: "same-series-as", peerCardId: 3, seriesCode: "orbit", tier: "secondary" },
    ]);
  });

  test("cycles are safe and cards never repeat", () => {
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("a")] });
    stampRelatedCards([a, b]);

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" }]);
    expect(b.relatedCards).toEqual([{ cardId: 1, kind: "mentioned-in", peerCardId: 2, tier: "primary" }]);
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

    expect(a.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" }]);
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

    expect(real.relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" }]);
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

  test("an edge lands in the tier its direction gives it", () => {
    // A names one card and transforms into two, so every primary kind is
    // reachable from the same root, and each assertion below names the
    // direction of that edge rather than an accident of the fixture.
    const a = card({
      cardId: 1,
      slug: "a",
      name: "A",
      abilities: [abilityWithLink("named")],
      passives: [passiveMentioningCard("C"), passiveMentioningSeries("flame")],
    });
    const named = card({ cardId: 2, slug: "named", name: "Named" });
    const c = card({ cardId: 3, slug: "c", name: "C" });
    const member = card({ cardId: 4, slug: "member", name: "S One", type: "skill", series: "flame" });
    const later = card({ cardId: 5, slug: "a_ii", name: "A II", evolvedFrom: 1 });
    const weapon = card({ cardId: 6, slug: "weapon", name: "Weapon", type: "equipment", ignitedFrom: 1 });
    a.evolveInto = { triggers: [], cardId: 5 };
    a.igniteInto = { triggers: [], cardId: 6 };
    weapon.igniteInto = { triggers: [], cardId: 1 };
    stampRelatedCards([a, named, c, member, later, weapon]);

    expect(a.relatedCards).toEqual([
      // Downward: A transforms into the card, or A's own copy names it.
      { cardId: 5, kind: "evolves-from", peerCardId: 1, tier: "primary" },
      { cardId: 6, kind: "ignited-from", peerCardId: 1, tier: "primary" },
      { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 3, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 4, kind: "series-mentioned", peerCardId: 1, seriesCode: "flame", tier: "primary" },
    ]);
  });

  test("a card that names this one is secondary, however it does the naming", () => {
    // `mentions` and `mentioned-in` are the two directions of one mention.
    // Only the direction the focused card owns is primary.
    const focus = card({ cardId: 1, slug: "focus", name: "Focus" });
    const namer = card({ cardId: 2, slug: "namer", name: "B", passives: [passiveMentioningCard("Focus")] });
    const bystander = card({ cardId: 3, slug: "bystander", name: "C" });
    stampRelatedCards([focus, namer, bystander]);

    // B names A, so B's entry on A's list is the upward edge. A names nothing
    // itself, and nothing reaches C from A at all.
    expect(focus.relatedCards).toEqual([
      { cardId: 2, kind: "mentions", peerCardId: 1, tier: "secondary" },
    ]);
  });

  test("a card keeps the entry of the edge that reached it first", () => {
    // Two edges reach the card the earlier stage transforms into: the
    // transformation its own block names, and the series it shares with the
    // earlier stage. It appears once, under the edge the walk reached it by, and
    // it is primary either way because its own copy names both.
    const base = card({ cardId: 1, slug: "base", name: "Base", series: "orbit" });
    const later = card({ cardId: 2, slug: "base_ii", name: "Base II", series: "orbit" });
    base.evolveInto = { triggers: [], cardId: 2 };
    stampRelatedCards([base, later]);

    // Only the earlier stage's block exists, so the arrow runs one way: the
    // later stage's own copy names nothing and owns nothing.
    expect(base.relatedCards).toEqual([
      { cardId: 2, kind: "evolves-from", peerCardId: 1, tier: "primary" },
    ]);
    expect(later.relatedCards).toEqual([
      { cardId: 1, kind: "same-series-as", peerCardId: 2, seriesCode: "orbit", tier: "secondary" },
    ]);
  });

  test("primary is the whole forward walk, and only the forward walk", () => {
    // The rule the tiers exist for, as one fixture: A names B, B names C, so A
    // reaches B and C forward. D names A, which is an arrow pointing into A, so
    // D is reached against an arrow however close it is.
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", abilities: [abilityWithLink("c")] });
    const c = card({ cardId: 3, slug: "c", name: "C" });
    const d = card({ cardId: 4, slug: "d", name: "D", abilities: [abilityWithLink("a")] });
    stampRelatedCards([a, b, c, d]);

    expect(a.relatedCards).toEqual([
      { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      { cardId: 3, kind: "mentioned-in", peerCardId: 2, tier: "primary" },
      { cardId: 4, kind: "mentions", peerCardId: 1, tier: "secondary" },
    ]);
  });

  test("the tier partition never drops a card the closure reached", () => {
    // A card past the first step is reached by an edge the tier sort would
    // otherwise skip, so the closure must still hold it.
    const a = card({ cardId: 1, slug: "a", name: "A", abilities: [abilityWithLink("b")] });
    const b = card({ cardId: 2, slug: "b", name: "B", evolvedFrom: 3 });
    const bBase = card({ cardId: 3, slug: "b_base", name: "B Base" });
    const sibling = card({ cardId: 4, slug: "sibling", name: "Sibling", series: "orbit" });
    bBase.series = "orbit";
    stampRelatedCards([a, b, bBase, sibling]);

    expect(a.relatedCards.map((entry) => entry.cardId).sort()).toEqual([2, 3, 4]);
    // 2 is A's own mention, so it is primary. 3 is reached through 2 and 4
    // through 3, so neither is a relation A owns.
    expect(a.relatedCards.map((entry) => `${entry.cardId}:${entry.tier}`)).toEqual([
      "2:primary",
      "3:secondary",
      "4:secondary",
    ]);
  });
});
