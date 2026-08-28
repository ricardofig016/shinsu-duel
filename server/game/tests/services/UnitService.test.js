import UnitService from "../../services/UnitService.js";

describe("UnitService", () => {
  describe("damage", () => {
    test("reduces HP by the damage amount and reports applied", () => {
      const unit = { currentHp: 5 };
      const result = UnitService.damage(unit, 3);
      expect(result.applied).toBe(3);
      expect(result.currentHp).toBe(2);
      expect(unit.currentHp).toBe(2);
    });

    test("clamps damage to remaining HP", () => {
      const unit = { currentHp: 2 };
      const result = UnitService.damage(unit, 10);
      expect(result.applied).toBe(2);
      expect(unit.currentHp).toBe(0);
    });

    test("ignores negative damage", () => {
      const unit = { currentHp: 5 };
      const result = UnitService.damage(unit, -3);
      expect(result.applied).toBe(0);
      expect(unit.currentHp).toBe(5);
    });
  });

  describe("heal", () => {
    test("increases HP and reports healed", () => {
      const unit = { currentHp: 2, card: { maxHp: 5 } };
      const result = UnitService.heal(unit, 2);
      expect(result.healed).toBe(2);
      expect(unit.currentHp).toBe(4);
    });

    test("caps healing at max HP", () => {
      const unit = { currentHp: 4, card: { maxHp: 5 } };
      const result = UnitService.heal(unit, 10);
      expect(result.healed).toBe(1);
      expect(unit.currentHp).toBe(5);
    });

    test("ignores negative healing", () => {
      const unit = { currentHp: 2, card: { maxHp: 5 } };
      const result = UnitService.heal(unit, -1);
      expect(result.healed).toBe(0);
      expect(unit.currentHp).toBe(2);
    });
  });

  describe("setHp", () => {
    test("sets HP to an absolute value", () => {
      const unit = { currentHp: 0 };
      expect(UnitService.setHp(unit, 1)).toBe(1);
      expect(unit.currentHp).toBe(1);
    });

    test("floors HP at 0", () => {
      const unit = { currentHp: 3 };
      UnitService.setHp(unit, -5);
      expect(unit.currentHp).toBe(0);
    });
  });

  describe("grantHp", () => {
    test("raises both current and max HP by the granted amount (2/8 +2 -> 4/10)", () => {
      const unit = { currentHp: 2, card: { maxHp: 8 } };
      const result = UnitService.grantHp(unit, 2);
      expect(result).toEqual({ granted: 2, currentHp: 4, maxHp: 10 });
      expect(unit.currentHp).toBe(4);
      expect(unit.card.maxHp).toBe(10);
    });

    test("preserves the lost-HP delta (a unit 6 below max stays 6 below max)", () => {
      const unit = { currentHp: 2, card: { maxHp: 8 } };
      UnitService.grantHp(unit, 2);
      expect(unit.card.maxHp - unit.currentHp).toBe(6);
    });

    test("ignores negative grants", () => {
      const unit = { currentHp: 2, card: { maxHp: 8 } };
      const result = UnitService.grantHp(unit, -3);
      expect(result.granted).toBe(0);
      expect(unit.currentHp).toBe(2);
      expect(unit.card.maxHp).toBe(8);
    });
  });
});
