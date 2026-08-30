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
});
