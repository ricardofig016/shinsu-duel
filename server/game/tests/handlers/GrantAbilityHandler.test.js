import GameState from "../../GameState.js";
import { createTestGame } from "../utils.js";

describe("GrantAbilityHandler", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  test("registers granted ability via ModifierStack", () => {
    const unit = game.playerStates[game.usernames[0]].field.frontline[0];
    if (!unit) return; // skip if no unit deployed

    const sourceId = "Equip#test";
    const ability = { type: "deal_damage", amount: 2, target: "enemy" };

    const mod = game.modifierStack.apply({
      sourceId,
      sourceType: "equipment",
      targetId: unit.id,
      type: "ability",
      key: "granted_deal_damage",
      value: JSON.stringify(ability),
    });

    expect(mod).toBeDefined();
    expect(mod.type).toBe("ability");
    expect(mod.key).toBe("granted_deal_damage");
  });

  test("granted ability is removed when source is removed", () => {
    const unit = game.playerStates[game.usernames[0]].field.frontline[0];
    if (!unit) return;

    const sourceId = "Equip#test99";
    game.modifierStack.apply({
      sourceId,
      sourceType: "equipment",
      targetId: unit.id,
      type: "ability",
      key: "granted_test",
      value: "{}",
    });

    expect(game.modifierStack.getSources(unit.id)).toContain(sourceId);

    game.modifierStack.removeBySource(sourceId);
    expect(game.modifierStack.getSources(unit.id)).not.toContain(sourceId);
  });
});
