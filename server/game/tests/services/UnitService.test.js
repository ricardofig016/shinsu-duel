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
});
