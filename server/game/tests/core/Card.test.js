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

  test("serializes rank and the printed requirement, effect, and rule texts", () => {
    const card = makeCard({
      rank: "ranker",
      requirements: ["you control a fisherman"],
      effects: [{ type: "deal_damage", raw: "deal 2" }, { type: "draw", text: "draw a card" }],
      rules: [{ type: "disable_passives", raw: "passives have no effect" }],
    });
    const view = card.toSanitizedObject();

    expect(view.rank).toBe("ranker");
    expect(view.requirements).toEqual(["you control a fisherman"]);
    expect(view.effects).toEqual(["deal 2", "draw a card"]);
    expect(view.rules).toEqual(["passives have no effect"]);
  });

  test("serializes evolve and ignition trigger texts, null when absent", () => {
    const evolving = makeCard({
      evolveInto: { triggers: [{ type: "deploy", raw: "when i am deployed" }], cardId: 2 },
      igniteInto: { triggers: [{ type: "slay", raw: "the bearer Slays a unit" }], cardId: 3 },
    });
    const view = evolving.toSanitizedObject();
    expect(view.evolveTriggers).toEqual(["when i am deployed"]);
    expect(view.igniteTriggers).toEqual(["the bearer Slays a unit"]);

    const bare = makeCard();
    expect(bare.toSanitizedObject().evolveTriggers).toBeNull();
    expect(bare.toSanitizedObject().igniteTriggers).toBeNull();
  });

  test("stamps attribute details with icon paths into a copy, dropping unknown codes", () => {
    const card = makeCard({ attributes: ["hwayeomsa", "no-such-attribute"] });
    const view = card.toSanitizedObject();

    expect(view.attributes).toEqual({
      hwayeomsa: {
        name: "Hwayeomsa",
        description: expect.any(String),
        iconPath: "/assets/icons/attributes/hwayeomsa.png",
      },
    });

    view.attributes.hwayeomsa.name = "mutated";
    expect(card.toSanitizedObject().attributes.hwayeomsa.name).not.toBe("mutated");
  });
});
