import { deployUnit, setupGameWithHands } from "../utils.js";
import GiveConditionHandler from "../../handlers/GiveConditionHandler.js";
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
});
