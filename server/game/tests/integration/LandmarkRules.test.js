import { deployUnit, getCardIdByName, setupGameWithHands } from "../utils.js";
import GiveConditionHandler from "../../handlers/GiveConditionHandler.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import * as IdFactory from "../../IdFactory.js";
import EVT from "../../EventCatalog.js";

describe("landmark rule enforcement", () => {
  test("Name Hunt Station chooses a canonical position, serializes it, and applies only its chosen-position rules", () => {
    const game = setupGameWithHands({
      Alice: ["Test Name Hunt Station"],
      Bob: ["Test Scout", "Test Irregular Unit"],
    });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");

    expect(game.pendingDecision.type).toBe("position_selection");
    expect(game.pendingDecision.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "scout", name: "Scout" }),
      expect.objectContaining({ id: "fisherman", name: "Fisherman" }),
    ]));

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });
    const scout = deployUnit(game, "Bob", "Test Scout", "scout");
    const irregular = deployUnit(game, "Bob", "Test Irregular Unit", "scout");

    expect(station.chosenPositionCode).toBe("scout");
    expect(game.modifierStack.has(scout.id, "condition", "rooted")).toBe(true);
    expect(game.modifierStack.has(irregular.id, "condition", "rooted")).toBe(false);
    expect(game._globalRuleRegistry.hasRule(scout, "prevent_evolve", game)).toBe(true);
    expect(game._globalRuleRegistry.hasRule(irregular, "prevent_evolve", game)).toBe(false);
    expect(game.toSerializedState().players.Alice.backline[0].chosenPositionCode).toBe("scout");
  });

  test("Floor of Death suppresses standard passives but does not affect Irregular passive rules", () => {
    const game = setupGameWithHands({
      Alice: ["Test Floor of Death"],
      Bob: ["Test Burn Passive Unit", "Test Irregular Unit"],
    });
    deployUnit(game, "Alice", "Test Floor of Death", "backline");
    const regular = deployUnit(game, "Bob", "Test Burn Passive Unit", "wave-controller");
    const irregular = deployUnit(game, "Bob", "Test Irregular Unit", "scout");

    expect(game._globalRuleRegistry.hasRule(regular, "disable_passives", game)).toBe(true);
    expect(game._globalRuleRegistry.hasRule(irregular, "disable_passives", game)).toBe(false);
  });

  test("Water Stadium caps ordinary condition applications at two stacks", () => {
    const game = setupGameWithHands({ Alice: ["Test Water Stadium"], Bob: ["Test Scout"] });
    deployUnit(game, "Alice", "Test Water Stadium", "backline");
    const target = deployUnit(game, "Bob", "Test Scout", "scout");
    GiveConditionHandler.applyCondition({
      sourceId: "test",
      targetId: target.id,
      condition: "poisoned",
      amount: 5,
    }, game);

    expect(game.modifierStack.getEffective(target.id, "condition", "poisoned")).toBe(2);
  });

  test("round-end cleanup restores an eligible continuous landmark condition", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"], Bob: ["Test Scout"] });
    deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });
    const target = deployUnit(game, "Bob", "Test Scout", "scout");

    expect(game.modifierStack.has(target.id, "condition", "rooted")).toBe(true);
    game.eventBus.emit(EVT.ROUND_END, {});
    expect(game.modifierStack.has(target.id, "condition", "rooted")).toBe(true);
  });

  test("chosen-position prevention blocks evolution and equipment through LifecycleEngine", () => {
    const game = setupGameWithHands({
      Alice: ["Test Name Hunt Station", "Test Evolve Unit", "Test Armor"],
    });
    deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["fisherman"], username: "Alice" });
    const target = deployUnit(game, "Alice", "Test Evolve Unit", "fisherman");
    const armorIndex = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Armor");

    expect(LifecycleEngine.transformUnit(game, target, getCardIdByName("Test Evolve Unit - Evolved"))).toEqual({
      prevented: true,
      reason: "landmark rule",
    });
    expect(target.card.name).toBe("Test Evolve Unit");
    expect(() => LifecycleEngine.attachEquipment(game, "Alice", armorIndex, target)).toThrow("landmark rule");
  });

  test("rules apply to both boards and derived grants follow position changes", () => {
    const game = setupGameWithHands({
      Alice: ["Test Name Hunt Station", "Test Scout"],
      Bob: ["Test Scout"],
    });
    deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });
    const ally = deployUnit(game, "Alice", "Test Scout", "scout");
    const enemy = deployUnit(game, "Bob", "Test Scout", "fisherman");

    expect(game._globalRuleRegistry.hasRule(ally, "prevent_equip", game)).toBe(true);
    expect(game.modifierStack.has(ally.id, "condition", "rooted")).toBe(true);
    expect(game._globalRuleRegistry.hasRule(enemy, "prevent_equip", game)).toBe(false);

    LifecycleEngine.switchPosition(game, enemy, "scout");
    expect(game._globalRuleRegistry.hasRule(enemy, "prevent_equip", game)).toBe(true);
    expect(game.modifierStack.has(enemy.id, "condition", "rooted")).toBe(true);

    LifecycleEngine.switchPosition(game, enemy, "fisherman");
    expect(game._globalRuleRegistry.hasRule(enemy, "prevent_equip", game)).toBe(false);
    expect(game.modifierStack.has(enemy.id, "condition", "rooted")).toBe(false);
  });

  test("replacing or removing a landmark revokes its rules and derived grants", () => {
    const game = setupGameWithHands({
      Alice: ["Test Name Hunt Station", "Test Landmark Rules"],
      Bob: ["Test Scout"],
    });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });
    const target = deployUnit(game, "Bob", "Test Scout", "scout");

    const replacement = deployUnit(game, "Alice", "Test Landmark Rules", "backline");
    expect(game._globalRuleRegistry.hasRule(target, "prevent_evolve", game)).toBe(false);
    expect(game.modifierStack.has(target.id, "condition", "rooted")).toBe(false);
    expect(game.modifierStack.getModifiersByType("rule").some((mod) => mod.sourceId === IdFactory.landmarkSource(station.id))).toBe(false);

    LifecycleEngine.destroyUnit(game, replacement);
    expect(game.modifierStack.getModifiersByType("rule").some((mod) => mod.sourceId === IdFactory.landmarkSource(replacement.id))).toBe(false);
  });

  test("global trait grants reconcile by source without revoking an independent landmark", () => {
    const game = setupGameWithHands({
      Alice: ["Test Global Trait Landmark", "Test Scout"],
      Bob: ["Test Global Trait Landmark Two", "Test Scout", "Test Irregular Unit"],
    });
    const first = deployUnit(game, "Alice", "Test Global Trait Landmark", "backline");
    const second = deployUnit(game, "Bob", "Test Global Trait Landmark Two", "backline");
    const ally = deployUnit(game, "Alice", "Test Scout", "scout");
    const enemy = deployUnit(game, "Bob", "Test Scout", "scout");
    const irregular = deployUnit(game, "Bob", "Test Irregular Unit", "scout");

    expect(game.modifierStack.getModifiers(ally.id, "trait").filter((mod) => mod.key === "strong" && mod.meta?.landmarkGrant)).toHaveLength(2);
    expect(game.modifierStack.getModifiers(enemy.id, "trait").filter((mod) => mod.key === "strong" && mod.meta?.landmarkGrant)).toHaveLength(2);
    expect(game.modifierStack.has(irregular.id, "trait", "strong")).toBe(false);

    LifecycleEngine.destroyUnit(game, first);
    const remaining = game.modifierStack.getModifiers(enemy.id, "trait").filter((mod) => mod.key === "strong" && mod.meta?.landmarkGrant);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].sourceId).toBe(IdFactory.landmarkSource(second.id));

    LifecycleEngine.switchPosition(game, enemy, "fisherman");
    expect(game.modifierStack.has(enemy.id, "trait", "strong")).toBe(false);
  });

  test("disable_passives suppresses a landmark's own passive", () => {
    const game = setupGameWithHands({
      Alice: ["Test Floor of Death", "Test Prevent Evolve Landmark"],
    });
    deployUnit(game, "Alice", "Test Prevent Evolve Landmark", "backline");
    const floor = deployUnit(game, "Alice", "Test Floor of Death", "backline");

    expect(game._globalRuleRegistry.hasRule(floor, "disable_passives", game)).toBe(true);
    expect(game.pendingDecision).toBeNull();
  });
});
