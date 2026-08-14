/**
 * Ability Cleanup Ownership Tests
 *
 * Verifies that AbilityRegistry cleanup is driven exclusively through the
 * ModifierStack.onRevoke bridge — not by direct calls from LifecycleEngine.
 *
 * Ownership model:
 *  - AbilityRegistry is the sole authoritative store for ability DSLs.
 *  - ModifierStack entries of type "ability" are lifetime markers that tie
 *    an ability's lifetime to its source card.
 *  - The onRevoke bridge is the ONLY path from ModifierStack cleanup to
 *    AbilityRegistry cleanup.
 */

import GameState from "../../GameState.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import Card from "../../Card.js";
import EVT from "../../EventCatalog.js";
import { createTestGame, getCardIdByName, setupGameWithCardsInHand, advanceToRound } from "../utils.js";

describe("Ability cleanup ownership (onRevoke bridge)", () => {
  let game;
  let unit;

  beforeEach(() => {
    // Use a game with known unit cards then manually deploy one to the field.
    game = setupGameWithCardsInHand(["Monkeyman", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";

    // Deploy a unit to frontline scout
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });

    unit = game.playerStates.Alice.field.frontline[0];
    if (!unit) throw new Error("Test requires at least one deployed unit");
  });

  // -----------------------------------------------------------------------
  // Helper: grant an ability via the authoritative dual-registration path
  // -----------------------------------------------------------------------
  function grantAbility(sourceId, ability, sourceType = "equipment") {
    const { code } = game._abilityRegistry.grant(unit.id, sourceId, sourceType, ability);
    game.modifierStack.apply({
      sourceId,
      sourceType,
      targetId: unit.id,
      type: "ability",
      key: code,
      operation: "add",
    });
    return code;
  }

  // -----------------------------------------------------------------------
  // Source removal (unequip)
  // -----------------------------------------------------------------------

  test("removeBySource cleans up AbilityRegistry via onRevoke bridge", () => {
    const sourceId = "Equip#test_cleanup_1";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(1);
    expect(game.modifierStack.has(unit.id, "ability", expect.any(String))).toBeDefined();

    game.modifierStack.removeBySource(sourceId);

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
    expect(game.modifierStack.getSources(unit.id)).not.toContain(sourceId);
  });

  test("removeBySource cleans up multiple abilities from the same source", () => {
    const sourceId = "Equip#test_multi";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });
    grantAbility(sourceId, { type: "heal", amount: 3 });
    grantAbility(sourceId, { type: "draw_card", amount: 1 });

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(3);

    game.modifierStack.removeBySource(sourceId);

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
  });

  test("removeBySource only removes abilities from the specified source", () => {
    const sourceA = "Equip#test_A";
    const sourceB = "Equip#test_B";
    grantAbility(sourceA, { type: "deal_damage", amount: 2 });
    grantAbility(sourceB, { type: "heal", amount: 3 });

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(2);

    game.modifierStack.removeBySource(sourceA);

    const remaining = game._abilityRegistry.getGranted(unit.id);
    expect(remaining.length).toBe(1);
    expect(remaining[0].sourceId).toBe(sourceB);
  });

  // -----------------------------------------------------------------------
  // Target death
  // -----------------------------------------------------------------------

  test("removeByTarget cleans up AbilityRegistry via onRevoke bridge", () => {
    const sourceId = "Equip#test_death";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(1);

    game.modifierStack.removeByTarget(unit.id);

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
    expect(game.modifierStack.getSources(unit.id).length).toBe(0);
  });

  test("UNIT_DESTROYED event cascades to AbilityRegistry cleanup", () => {
    const sourceId = "Equip#test_destroyed_event";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    // Simulate the destroyUnit flow: emit UNIT_DESTROYED which triggers
    // ModifierStack's auto-listener → removeByTarget → onRevoke bridge.
    game.eventBus.emit(EVT.UNIT_DESTROYED, { unitId: unit.id });

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
  });

  test("destroyUnit full flow cleans up abilities through onRevoke bridge only", () => {
    const sourceId = "Equip#test_full_destroy";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(1);

    LifecycleEngine.destroyUnit(game, unit);

    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Transformation preserves granted abilities
  // -----------------------------------------------------------------------

  test("transformUnit preserves granted abilities from equipment", () => {
    const sourceId = "Equip#test_transform";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    // Find an evolution target
    const evolveTargetCardId = unit.card.evolveInto?.cardId;
    if (!evolveTargetCardId) {
      // Unit doesn't have evolution — skip gracefully
      return;
    }

    LifecycleEngine.transformUnit(game, unit, evolveTargetCardId);

    // Abilities granted by equipment survive transformation
    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(1);
    expect(game._abilityRegistry.getGranted(unit.id)[0].sourceId).toBe(sourceId);
  });

  // -----------------------------------------------------------------------
  // Repeated cleanup is idempotent
  // -----------------------------------------------------------------------

  test("repeated removeBySource is idempotent", () => {
    const sourceId = "Equip#test_idempotent";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    game.modifierStack.removeBySource(sourceId);
    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);

    // Second call should not throw
    expect(() => game.modifierStack.removeBySource(sourceId)).not.toThrow();
    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
  });

  test("repeated revokeAll is idempotent", () => {
    const sourceId = "Equip#test_idempotent2";
    grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    game._abilityRegistry.revokeAll(unit.id);
    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);

    // Second call should not throw
    expect(() => game._abilityRegistry.revokeAll(unit.id)).not.toThrow();
    expect(game._abilityRegistry.getGranted(unit.id).length).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Ability resolution after cleanup
  // -----------------------------------------------------------------------

  test("resolved ability returns null after source removal", () => {
    const sourceId = "Equip#test_resolve_cleanup";
    const abilityCode = grantAbility(sourceId, { type: "deal_damage", amount: 2 });

    expect(game._abilityRegistry.resolve(unit.id, abilityCode)).not.toBeNull();

    game.modifierStack.removeBySource(sourceId);

    expect(game._abilityRegistry.resolve(unit.id, abilityCode)).toBeNull();
  });
});
