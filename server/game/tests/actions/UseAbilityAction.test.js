import UseAbilityAction from "../../actions/UseAbilityAction.js";
import { setupGameWithCardsInHand, advanceToRound } from "../utils.js";

describe("UseAbilityAction", () => {
  function deployMonkeyman(position) {
    const game = setupGameWithCardsInHand(["Monkeyman", "Monkeyman", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 3, recharged: 0 };
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: position },
    });
    game.currentTurn = "Alice";
    return { game, unit: game.playerStates.Alice.field.frontline[0] ?? game.playerStates.Alice.field.backline[0] };
  }

  const deployMonkeymanAsFisherman = () => deployMonkeyman("fisherman");
  const deployMonkeymanAsScout = () => deployMonkeyman("scout");

  describe("resolveAbility", () => {
    test("resolves a native ability by numeric index", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      const resolved = UseAbilityAction.resolveAbility(game, unit, "1");
      expect(resolved.ability.type).toBe("deal_damage");
      expect(resolved.sourceType).toBe("unit");
      expect(resolved.sourceId).toBe(unit.id);
    });

    test("returns null for an out-of-range index", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      expect(UseAbilityAction.resolveAbility(game, unit, "99")).toBeNull();
    });

    test("returns null for a non-integer code", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      expect(UseAbilityAction.resolveAbility(game, unit, "abc")).toBeNull();
    });

    test("returns null for a unit with no abilities", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      unit.card.abilities = [];
      expect(UseAbilityAction.resolveAbility(game, unit, "0")).toBeNull();
    });
  });

  describe("validate", () => {
    test("throws when it is not the player's turn", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      game.currentTurn = "Bob";
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "1" },
        })
      ).toThrow("not your turn");
    });

    test("throws for a unit not on the player's field", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      game.currentTurn = "Bob";
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Bob", unitId: unit.id, abilityCode: "1" },
        })
      ).toThrow(/not found in your field|not your turn/);
    });

    test("throws for an invalid abilityCode", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "99" },
        })
      ).toThrow("Invalid abilityCode");
    });

    test("throws when the ability requires a different position", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      // Ability 0 (scout) requires the scout position; unit is a fisherman.
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "0" },
        })
      ).toThrow("requires the scout position");
    });

    test("throws when the unit is stunned", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      game.modifierStack.apply({
        sourceId: "System", sourceType: "system", targetId: unit.id,
        type: "condition", key: "stunned", value: 1,
      });
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "1" },
        })
      ).toThrow("Stunned");
    });

    test("throws when the combat slot is already used this round", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      game.playerStates.Alice.combatSlots.fisherman.available = false;
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "1" },
        })
      ).toThrow("already used this round");
    });

    test("throws when the player cannot afford the ability cost", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 0, recharged: 0 };
      // Give the unit a spend_shinsu ability.
      unit.card.abilities[1] = { type: "spend_shinsu", amount: 2, quick: false, position: "fisherman" };
      expect(() =>
        game.processAction({
          type: "use-ability-action",
          data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "1" },
        })
      ).toThrow("Not enough shinsu");
    });
  });

  describe("execute", () => {
    test("uses a non-quick ability and ends the turn", () => {
      const { game, unit } = deployMonkeymanAsFisherman();
      // Give the unit a free self-heal ability (non-quick).
      unit.card.abilities[1] = { type: "heal", amount: 1, target: "self", quick: false, position: "fisherman" };
      unit.currentHp = 1;

      game.processAction({
        type: "use-ability-action",
        data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "1" },
      });

      expect(unit.currentHp).toBe(2);
      expect(game.currentTurn).toBe("Bob");
      // Combat slot consumed.
      expect(game.playerStates.Alice.combatSlots.fisherman.available).toBe(false);
    });

    test("a quick ability does not end the turn", () => {
      const { game, unit } = deployMonkeymanAsScout();
      // Monkeyman ability 0 is a quick scout ability.
      game.processAction({
        type: "use-ability-action",
        data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "0" },
      });

      expect(game.currentTurn).toBe("Alice");
    });

    test("a poisoned unit takes damage after using an ability", () => {
      const { game, unit } = deployMonkeymanAsScout();
      game.modifierStack.apply({
        sourceId: "System", sourceType: "system", targetId: unit.id,
        type: "condition", key: "poisoned", value: 1,
      });
      // Monkeyman max HP is 2.
      unit.currentHp = 2;

      game.processAction({
        type: "use-ability-action",
        data: { source: "player", username: "Alice", unitId: unit.id, abilityCode: "0" },
      });

      expect(unit.currentHp).toBe(1);
    });
  });
});
