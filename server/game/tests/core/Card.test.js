import Card from "../../Card.js";
import * as IdFactory from "../../IdFactory.js";

describe("Card", () => {
  beforeEach(() => {
    IdFactory.resetAll();
  });

  function makeCard(cardData = {}) {
    return new Card(1, {
      cardId: 1,
      type: "unit",
      name: "Test Unit",
      cost: 1,
      hp: 10,
      rank: "regular",
      positions: ["scout"],
      traits: [],
      affiliations: [],
      abilities: [],
      passives: [],
      attributes: [],
      requirements: [],
      effects: [],
      deckConstraints: [],
      ...cardData,
    }, "Alice", {});
  }

  test("uses the compiler-resolved artworkPath as-is", () => {
    const card = makeCard({ artworkPath: "/assets/images/artworks/test_unit.png" });
    expect(card.artworkPath).toBe("/assets/images/artworks/test_unit.png");
  });

  test("defaults artworkPath to null when the compiled card has none", () => {
    const card = makeCard();
    expect(card.artworkPath).toBeNull();
  });

  test("serializes artworkPath to clients", () => {
    const card = makeCard({ artworkPath: "/assets/images/artworks/karaka.png" });
    expect(card.toSanitizedObject().artworkPath).toBe("/assets/images/artworks/karaka.png");

    const bare = makeCard();
    expect(bare.toSanitizedObject().artworkPath).toBeNull();
  });

  test("stamps printed traits with the card's own value, gated on the numeric flag", () => {
    const card = makeCard({
      traits: [{ code: "resilient", value: 3 }, { code: "strong" }, { code: "barrier" }],
    });
    const traits = card.toSanitizedObject().traits;

    expect(traits.resilient).toMatchObject({ name: "Resilient", numeric: true, value: 3 });
    expect(traits.resilient.description.segments).toEqual([
      "I take -",
      { type: "value", ref: "trait", text: "x" },
      " damage from all sources",
    ]);
    // The engine wires a numeric trait authored without a value at 1, so the
    // card face states the same number the unit will have.
    expect(traits.strong).toMatchObject({ numeric: true, value: 1 });
    // A valueless trait keeps the engine's wiring value but shows no number.
    expect(traits.barrier).toMatchObject({ numeric: false, value: null });
  });

  test("serializes printed requirement, effect, and rule texts as display segments", () => {
    const card = makeCard({
      rank: "ranker",
      requirements: [{ type: "target_side", side: "ally", text: ["you control a fisherman"] }],
      effects: [{ type: "deal_damage", text: ["deal 2"] }, { type: "draw", text: ["draw a card"] }],
      rules: [{ type: "disable_passives", text: ["passives have no effect"] }],
    });
    const view = card.toSanitizedObject();

    expect(view.rank).toBe("ranker");
    expect(view.requirements).toEqual([
      { text: ["you control a fisherman"], check: { type: "target_side", side: "ally" } },
    ]);
    expect(view.effects).toEqual([["deal 2"], ["draw a card"]]);
    expect(view.rules).toEqual([["passives have no effect"]]);
  });

  test("ships one requirement entry per requirement, each a check beside its prose", () => {
    const requirements = [
      { type: "deployed_as", position: "fisherman", text: ["deployed as a fisherman"] },
      { type: "target_side", side: "enemy", text: ["target an enemy unit"] },
      { type: "bearer_has", affiliation: "khun-family", attribute: "anima", text: ["a Khun Anima bearer"] },
      { type: "unit_on_board", name: "Test Unit", text: ["Test Unit must be deployed"] },
      { type: "has_ally", affiliation: "khun-family", text: ["an ally from the Khun Family"] },
      { type: "first_card_this_round", text: ["the first card you play this round"] },
    ];
    const card = makeCard({ type: "skill", requirements });
    const view = card.toSanitizedObject();

    expect(view.requirements).toHaveLength(requirements.length);
    for (const [index, requirement] of requirements.entries()) {
      const entry = view.requirements[index];
      // The prose is the very segments the compiled node carried, unchanged.
      expect(entry.text).toBe(requirement.text);
      // The check is that node with `text` removed: `type` and the node's own
      // parameters, addressed by the names `RequirementValidator` reads.
      const { text, ...expectedCheck } = requirement;
      expect(entry.check).toEqual(expectedCheck);
      expect(entry.check.type).toBe(requirement.type);
      expect(entry.check).not.toHaveProperty("text");
    }

    expect(view.requirements[0].check).toEqual({ type: "deployed_as", position: "fisherman" });
    expect(view.requirements[2].check).toEqual({
      type: "bearer_has",
      affiliation: "khun-family",
      attribute: "anima",
    });
    expect(view.requirements[5].check).toEqual({ type: "first_card_this_round" });
  });

  test("projects requirement checks without mutating the compiled card data", () => {
    const requirements = [
      { type: "deployed_as", position: "fisherman", text: ["deployed as a fisherman"] },
      { type: "unit_on_board", name: "Test Unit", text: ["Test Unit must be deployed"] },
    ];
    const card = makeCard({ type: "equipment", requirements });
    const snapshot = JSON.parse(JSON.stringify(card.requirements));

    card.toSanitizedObject();

    // The compiled catalog is shared: a projected view must never strip `text`
    // from the source node, or every other card reading it would lose its prose.
    expect(card.requirements).toEqual(snapshot);
    expect(card.requirements[0].text).toEqual(["deployed as a fisherman"]);
    expect(card.requirements[1].text).toEqual(["Test Unit must be deployed"]);
  });

  test("leaves a card with no requirements unaffected", () => {
    expect(makeCard().toSanitizedObject().requirements).toEqual([]);
    expect(makeCard({ requirements: [] }).toSanitizedObject().requirements).toEqual([]);
  });

  test("drops a requirement that carries no display segments, as its prose fields do", () => {
    const card = makeCard({
      type: "skill",
      requirements: [
        { type: "first_card_this_round", text: [] },
        { type: "target_side", side: "ally", text: ["you control a fisherman"] },
      ],
    });

    expect(card.toSanitizedObject().requirements).toEqual([
      { text: ["you control a fisherman"], check: { type: "target_side", side: "ally" } },
    ]);
  });

  test("ships the compression-reduced printed cost as a display value", () => {
    const card = makeCard({ cost: 4 });
    // `costReduction` is the field CompressionService maintains.
    card.costReduction = 2;
    const view = card.toSanitizedObject();

    expect(view.cost).toBe(4);
    expect(view.costReduction).toBe(2);
    // The bare card resolves no `modify_cost` node and sees no board-wide cost
    // modifier, so the field is the compression-only display value; the seat
    // projection overwrites it with the engine's resolved cost.
    expect(view.effectiveCost).toBe(2);
  });

  test("never presents a negative or unresolved cost as the effective cost", () => {
    const card = makeCard({ cost: 1 });
    card.costReduction = 3;

    expect(card.toSanitizedObject().effectiveCost).toBe(0);
  });

  test("ships relatedCards untouched and defaults to null when unstamped", () => {
    const related = makeCard({ relatedCards: [{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }] });
    expect(related.toSanitizedObject().relatedCards).toEqual([{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }]);

    expect(makeCard().toSanitizedObject().relatedCards).toBeNull();
  });

  test("serializes the series code", () => {
    expect(makeCard({ series: "incinerate" }).toSanitizedObject().series).toBe("incinerate");
    expect(makeCard().toSanitizedObject().series).toBeNull();
  });

  test("serializes evolve and ignition trigger texts as segments, null when absent", () => {
    const evolving = makeCard({
      evolveInto: { triggers: [{ type: "deploy", text: ["when i am deployed"] }], cardId: 2 },
      igniteInto: { triggers: [{ type: "slay", text: ["the bearer Slays a unit"] }], cardId: 3 },
    });
    const view = evolving.toSanitizedObject();
    expect(view.evolveTriggers).toEqual([["when i am deployed"]]);
    expect(view.igniteTriggers).toEqual([["the bearer Slays a unit"]]);

    const bare = makeCard();
    expect(bare.toSanitizedObject().evolveTriggers).toBeNull();
    expect(bare.toSanitizedObject().igniteTriggers).toBeNull();
  });

  test("stamps attribute details with tooltip title, effect lines, and icon path, dropping unknown codes", () => {
    const card = makeCard({ attributes: ["hwayeomsa", "no-such-attribute"] });
    const view = card.toSanitizedObject();

    expect(view.attributes).toEqual({
      hwayeomsa: {
        name: "Hwayeomsa",
        title: "Hwayeomsa",
        description: { segments: expect.any(Array) },
        effect: expect.any(Array),
        iconPath: "/assets/icons/attributes/hwayeomsa.png",
      },
    });

    view.attributes.hwayeomsa.name = "mutated";
    expect(card.toSanitizedObject().attributes.hwayeomsa.name).not.toBe("mutated");
  });

  test("composes guide attribute tooltip titles with their category and carries the effect lines", () => {
    const card = makeCard({ attributes: ["silver-dwarf", "hwayeomsa"] });
    const view = card.toSanitizedObject();

    expect(view.attributes["silver-dwarf"].title).toBe("Guide - Silver Dwarf");
    expect(view.attributes.hwayeomsa.title).toBe("Hwayeomsa");
    expect(view.attributes["silver-dwarf"].effect).toEqual([
      { segments: ["The first time you draw a card each round, choose the card directly from your deck."] },
    ]);
  });

  test("orders attribute views by the attribute catalog, not the card's authored order", () => {
    const card = makeCard({ attributes: ["living-ignition-weapon", "hwayeomsa", "anima"] });
    const view = card.toSanitizedObject();

    expect(Object.keys(view.attributes)).toEqual(["anima", "hwayeomsa", "living-ignition-weapon"]);
  });
});
