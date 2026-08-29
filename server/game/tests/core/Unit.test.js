import Unit from "../../Unit.js";
import Card from "../../Card.js";
import * as IdFactory from "../../IdFactory.js";

describe("Unit", () => {
  beforeEach(() => {
    IdFactory.resetAll();
  });

  function unitCard(overrides = {}) {
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
      ...overrides,
    }, "Alice", {});
  }

  test("constructs with default state", () => {
    const card = unitCard();
    const unit = new Unit(card, "scout");
    expect(unit.id).toBe("Unit#1#1");
    expect(unit.currentHp).toBe(10);
    expect(unit.placedPositionCode).toBe("scout");
    expect(unit.owner).toBe("Alice");
    expect(unit.equipmentAttachments).toEqual([]);
  });

  test("initializes currentHp from entryHp when the card carries one", () => {
    const unit = new Unit(unitCard({ hp: 8, entryHp: 2 }), "scout");
    expect(unit.card.maxHp).toBe(8);
    expect(unit.currentHp).toBe(2);
  });

  test("throws when constructed without a card", () => {
    expect(() => new Unit(null, "scout")).toThrow("Card instance is required");
  });

  test("throws when constructed with a non-unit card", () => {
    const card = unitCard({ type: "skill" });
    expect(() => new Unit(card, "scout")).toThrow("Invalid card type");
  });

  test("isAlive reflects currentHp", () => {
    const unit = new Unit(unitCard(), "scout");
    expect(unit.isAlive()).toBe(true);
    unit.currentHp = 0;
    expect(unit.isAlive()).toBe(false);
  });

  test("toSanitizedObject exposes id, hp, position, owner", () => {
    const unit = new Unit(unitCard(), "scout");
    const obj = unit.toSanitizedObject();
    expect(obj.id).toBe(unit.id);
    expect(obj.currentHp).toBe(10);
    expect(obj.placedPositionCode).toBe("scout");
    expect(obj.owner).toBe("Alice");
  });

  test("toSanitizedObject exposes the card's entryHp, null when absent", () => {
    expect(unitCard({ hp: 8, entryHp: 2 }).toSanitizedObject().entryHp).toBe(2);
    expect(unitCard().toSanitizedObject().entryHp).toBeNull();

    const unit = new Unit(unitCard({ hp: 8, entryHp: 2 }), "scout");
    expect(unit.toSanitizedObject().card.entryHp).toBe(2);
  });
});
