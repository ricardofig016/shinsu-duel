import {
  ACTION_TYPES,
  buildDeployUnitAction,
  buildPlaySkillAction,
  buildEquipEquipmentAction,
  buildSwitchPositionAction,
  buildUseAbilityAction,
  buildPassTurnAction,
  buildDecision,
} from "../../game/actions.js";

describe("outbound action builders", () => {
  test("every action type keeps its wire name", () => {
    expect(ACTION_TYPES.DEPLOY_UNIT).toBe("deploy-unit-action");
    expect(ACTION_TYPES.PLAY_SKILL).toBe("play-skill-action");
    expect(ACTION_TYPES.EQUIP_EQUIPMENT).toBe("equip-equipment-action");
    expect(ACTION_TYPES.SWITCH_POSITION).toBe("switch-position-action");
    expect(ACTION_TYPES.USE_ABILITY).toBe("use-ability-action");
    expect(ACTION_TYPES.PASS_TURN).toBe("pass-turn-action");
  });

  test("buildDeployUnitAction returns the exact payload", () => {
    expect(buildDeployUnitAction(3, "scout")).toEqual({
      type: "deploy-unit-action",
      data: { handId: 3, placedPositionCode: "scout" },
    });
    expect(() => buildDeployUnitAction(-1, "scout")).toThrow(TypeError);
    expect(() => buildDeployUnitAction(1.5, "scout")).toThrow(TypeError);
    expect(() => buildDeployUnitAction(3, "")).toThrow(TypeError);
  });

  test("buildPlaySkillAction returns the exact payload", () => {
    expect(buildPlaySkillAction(0)).toEqual({ type: "play-skill-action", data: { handId: 0 } });
    expect(() => buildPlaySkillAction("0")).toThrow(TypeError);
  });

  test("buildEquipEquipmentAction returns the exact payload", () => {
    expect(buildEquipEquipmentAction(2, "unit-9")).toEqual({
      type: "equip-equipment-action",
      data: { handId: 2, targetUnitId: "unit-9" },
    });
    expect(() => buildEquipEquipmentAction(2, "")).toThrow(TypeError);
  });

  test("buildSwitchPositionAction returns the exact payload", () => {
    expect(buildSwitchPositionAction("unit-9", "light_bearer")).toEqual({
      type: "switch-position-action",
      data: { unitId: "unit-9", positionCode: "light_bearer" },
    });
    expect(() => buildSwitchPositionAction("", "light_bearer")).toThrow(TypeError);
  });

  test("buildUseAbilityAction returns the exact payload", () => {
    expect(buildUseAbilityAction("unit-9", "peek")).toEqual({
      type: "use-ability-action",
      data: { unitId: "unit-9", abilityCode: "peek" },
    });
    expect(() => buildUseAbilityAction("unit-9", "")).toThrow(TypeError);
  });

  test("buildPassTurnAction returns the exact payload", () => {
    expect(buildPassTurnAction()).toEqual({ type: "pass-turn-action", data: {} });
  });

  test("buildDecision returns the exact payload", () => {
    expect(buildDecision("decision-1", [77])).toEqual({ decisionId: "decision-1", choices: [77] });
    expect(() => buildDecision("decision-1", null)).toThrow(TypeError);
  });
});
