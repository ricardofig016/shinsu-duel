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

  test("a landmark's explicit rules activate immediately while its chosen rule waits for the choice", () => {
    const game = setupGameWithHands({
      Alice: ["Test Mixed Rule Landmark"],
      Bob: ["Test Scout"],
    });
    const scout = deployUnit(game, "Bob", "Test Scout", "scout");
    deployUnit(game, "Alice", "Test Mixed Rule Landmark", "backline");

    // The explicit scout-position grant is active and the chosen rule is
    // deferred; only one rule entry exists.
    expect(game.modifierStack.has(scout.id, "trait", "strong")).toBe(true);
    expect(game._globalRuleRegistry.hasRule(scout, "prevent_evolve", game)).toBe(false);
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(1);

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });

    // The chosen rule joins without disturbing the explicit one.
    expect(game._globalRuleRegistry.hasRule(scout, "prevent_evolve", game)).toBe(true);
    expect(game.modifierStack.has(scout.id, "trait", "strong")).toBe(true);
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(2);
  });

  test("destroying a landmark cancels its pending position choice and prevents rule resurrection", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"], Bob: ["Test Scout"] });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    const decisionId = game.pendingDecision.decisionId;
    expect(game.pendingDecision.type).toBe("position_selection");

    // The landmark leaves play while its choice is still pending.
    LifecycleEngine.destroyUnit(game, station);

    // The decision is cancelled, not left dangling.
    expect(game.pendingDecision).toBeNull();
    expect(game.hasUnresolvedDecisions()).toBe(false);
    expect(station.chosenPositionCode).toBeNull();

    // Resolving the stale decision is rejected; nothing is re-registered.
    expect(() => game.resolveDecision({ decisionId, choices: ["scout"], username: "Alice" }))
      .toThrow("no pending decision");
    expect(game.modifierStack.getModifiersByType("rule")
      .some((mod) => mod.sourceId === IdFactory.landmarkSource(station.id))).toBe(false);

    const scout = deployUnit(game, "Bob", "Test Scout", "scout");
    expect(game._globalRuleRegistry.hasRule(scout, "prevent_evolve", game)).toBe(false);
    expect(game.modifierStack.has(scout.id, "condition", "rooted")).toBe(false);
  });

  test("serialized state exposes the pending position choice before it resolves", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"] });
    deployUnit(game, "Alice", "Test Name Hunt Station", "backline");

    const state = game.toSerializedState();
    expect(state.pendingDecision).toEqual(expect.objectContaining({
      type: "position_selection",
      owner: "Alice",
    }));
    expect(state.players.Alice.backline[0].chosenPositionCode).toBeNull();
  });

  test("removing Floor of Death lets suppressed passives resume", () => {
    const game = setupGameWithHands({
      Alice: ["Test Floor of Death", "Test Scout"],
    });
    const floor = deployUnit(game, "Alice", "Test Floor of Death", "backline");
    const scoutCard = game.playerStates.Alice.hand.find((c) => c.name === "Test Scout");
    scoutCard.passiveAbilities = [{
      type: "modify_keyword",
      keyword: "quick",
      target: { side: "self" },
      raw: "i have Quick",
    }];
    const scout = deployUnit(game, "Alice", "Test Scout", "scout");

    // Floor's disable_passives suppresses the scout's always-on modifier.
    expect(game.modifierStack.getKeywords(scout, true).has("quick")).toBe(false);

    LifecycleEngine.destroyUnit(game, floor);
    // The always-on modifier re-applies once the rule is gone.
    expect(game.modifierStack.getKeywords(scout, true).has("quick")).toBe(true);
    expect(game.modifierStack.getModifiersByType("rule")
      .some((mod) => mod.sourceId === IdFactory.landmarkSource(floor.id))).toBe(false);
  });

  test("removing Water Stadium lifts its condition cap", () => {
    const game = setupGameWithHands({ Alice: ["Test Water Stadium"], Bob: ["Test Scout"] });
    const stadium = deployUnit(game, "Alice", "Test Water Stadium", "backline");
    const target = deployUnit(game, "Bob", "Test Scout", "scout");

    GiveConditionHandler.applyCondition({
      sourceId: "test",
      targetId: target.id,
      condition: "poisoned",
      amount: 5,
    }, game);
    expect(game.modifierStack.getEffective(target.id, "condition", "poisoned")).toBe(2);

    LifecycleEngine.destroyUnit(game, stadium);
    GiveConditionHandler.applyCondition({
      sourceId: "test",
      targetId: target.id,
      condition: "poisoned",
      amount: 5,
    }, game);
    expect(game.modifierStack.getEffective(target.id, "condition", "poisoned")).toBe(7);
  });

  test("two active condition caps apply the minimum cap and removing one restores the other", () => {
    const game = setupGameWithHands({
      Alice: ["Test Water Stadium"],
      Bob: ["Test Water Stadium Two", "Test Scout"],
    });
    const aliceCap = deployUnit(game, "Alice", "Test Water Stadium", "backline");
    deployUnit(game, "Bob", "Test Water Stadium Two", "backline");
    const target = deployUnit(game, "Bob", "Test Scout", "scout");

    GiveConditionHandler.applyCondition({
      sourceId: "test",
      targetId: target.id,
      condition: "poisoned",
      amount: 5,
    }, game);
    expect(game.modifierStack.getEffective(target.id, "condition", "poisoned")).toBe(2);

    LifecycleEngine.destroyUnit(game, aliceCap);
    GiveConditionHandler.applyCondition({
      sourceId: "test",
      targetId: target.id,
      condition: "poisoned",
      amount: 5,
    }, game);
    // The surviving cap 3 limits the merged stack to 3.
    expect(game.modifierStack.getEffective(target.id, "condition", "poisoned")).toBe(3);
  });

  test("explicit-position prevent_evolve blocks as a continuous scope on both boards", () => {
    const game = setupGameWithHands({
      Alice: ["Test Prevent Evolve Landmark", "Test Evolve Unit"],
      Bob: ["Test Evolve Unit"],
    });
    deployUnit(game, "Alice", "Test Prevent Evolve Landmark", "backline");
    const aliceUnit = deployUnit(game, "Alice", "Test Evolve Unit", "fisherman");
    const bobUnit = deployUnit(game, "Bob", "Test Evolve Unit", "scout");
    const evolved = getCardIdByName("Test Evolve Unit - Evolved");

    // Out of scope (fisherman): evolution proceeds on Alice's board.
    expect(game._globalRuleRegistry.hasRule(aliceUnit, "prevent_evolve", game)).toBe(false);
    expect(LifecycleEngine.transformUnit(game, aliceUnit, evolved)).not.toEqual({
      prevented: true,
      reason: "landmark rule",
    });
    expect(aliceUnit.card.name).toBe("Test Evolve Unit - Evolved");

    // In scope (scout): evolution blocked on Bob's board.
    expect(game._globalRuleRegistry.hasRule(bobUnit, "prevent_evolve", game)).toBe(true);
    expect(LifecycleEngine.transformUnit(game, bobUnit, evolved)).toEqual({
      prevented: true,
      reason: "landmark rule",
    });
    expect(bobUnit.card.name).toBe("Test Evolve Unit");

    // Move out of scope: evolution legal again.
    LifecycleEngine.switchPosition(game, bobUnit, "fisherman");
    expect(game._globalRuleRegistry.hasRule(bobUnit, "prevent_evolve", game)).toBe(false);
    expect(LifecycleEngine.transformUnit(game, bobUnit, evolved)).not.toEqual({
      prevented: true,
      reason: "landmark rule",
    });
    expect(bobUnit.card.name).toBe("Test Evolve Unit - Evolved");
  });

  test("explicit-position prevent_equip blocks as a continuous scope as the bearer moves", () => {
    const game = setupGameWithHands({
      Alice: ["Test Prevent Equip Landmark", "Test Scout", "Test Armor"],
    });
    deployUnit(game, "Alice", "Test Prevent Equip Landmark", "backline");
    const bearer = deployUnit(game, "Alice", "Test Scout", "fisherman");
    const armorIndex = () => game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Armor");

    // Out of scope: attaching is legal.
    LifecycleEngine.attachEquipment(game, "Alice", armorIndex(), bearer);
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Armor"]);

    // Move into scope: attaching is blocked before any hand mutation.
    LifecycleEngine.switchPosition(game, bearer, "scout");
    expect(game._globalRuleRegistry.hasRule(bearer, "prevent_equip", game)).toBe(true);
    LifecycleEngine.detachEquipment(game, bearer);
    expect(() => LifecycleEngine.attachEquipment(game, "Alice", armorIndex(), bearer)).toThrow("landmark rule");
    expect(bearer.equipmentAttachments).toEqual([]);

    // Move back out of scope: attaching is legal again.
    LifecycleEngine.switchPosition(game, bearer, "fisherman");
    expect(game._globalRuleRegistry.hasRule(bearer, "prevent_equip", game)).toBe(false);
    LifecycleEngine.attachEquipment(game, "Alice", armorIndex(), bearer);
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Armor"]);
  });

  test("non-evolution transformations ignore the prevent_evolve gate", () => {
    const game = setupGameWithHands({
      Alice: ["Test Prevent Evolve Landmark", "Test Evolve Unit"],
    });
    deployUnit(game, "Alice", "Test Prevent Evolve Landmark", "backline");
    const target = deployUnit(game, "Alice", "Test Evolve Unit", "scout");
    expect(game._globalRuleRegistry.hasRule(target, "prevent_evolve", game)).toBe(true);

    // The target is not this card's evolveInto, so the transform is not an
    // evolution and the gate must not stop it.
    const result = LifecycleEngine.transformUnit(game, target, getCardIdByName("Test Scout"));
    expect(result).not.toEqual({ prevented: true, reason: "landmark rule" });
    expect(target.card.name).toBe("Test Scout");
  });

  test("equipment ignition proceeds under an active prevent_equip rule", () => {
    const game = setupGameWithHands({
      Alice: ["Test Prevent Equip Landmark", "Test Scout", "Test Ignite Weapon"],
    });
    deployUnit(game, "Alice", "Test Prevent Equip Landmark", "backline");
    const bearer = deployUnit(game, "Alice", "Test Scout", "fisherman");
    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Ignite Weapon");
    LifecycleEngine.attachEquipment(game, "Alice", equipIdx, bearer);
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);

    // Move the bearer into the blocked position; igniting the already-attached
    // equipment is not "equipping" and must proceed.
    LifecycleEngine.switchPosition(game, bearer, "scout");
    expect(game._globalRuleRegistry.hasRule(bearer, "prevent_equip", game)).toBe(true);

    LifecycleEngine.transformEquipment(game, bearer, getCardIdByName("Test Ignite Weapon - Ignited"));
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon - Ignited"]);
  });

  test("a transform that changes kind re-registers landmark rules", () => {
    const game = setupGameWithHands({
      Alice: ["Test Scout", "Test Water Stadium"],
      Bob: ["Test Scout"],
    });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    const enemy = deployUnit(game, "Bob", "Test Scout", "scout");
    const sourceId = () => IdFactory.landmarkSource(unit.id);

    // Standard → landmark: the transformed unit acquires the landmark's rules.
    LifecycleEngine.transformUnit(game, unit, getCardIdByName("Test Water Stadium"));
    expect(unit.card.kind).toBe("landmark");
    expect(game.modifierStack.getModifiersByType("rule").some((mod) => mod.sourceId === sourceId())).toBe(true);
    expect(game._globalRuleRegistry.hasRule(enemy, "condition_stack_cap", game)).toBe(true);

    // Landmark → standard: the rules are revoked with the kind.
    LifecycleEngine.transformUnit(game, unit, getCardIdByName("Test Scout"));
    expect(unit.card.kind).toBe("standard");
    expect(game.modifierStack.getModifiersByType("rule").some((mod) => mod.sourceId === sourceId())).toBe(false);
    expect(game._globalRuleRegistry.hasRule(enemy, "condition_stack_cap", game)).toBe(false);
  });
});
