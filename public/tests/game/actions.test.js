import {
  ACTION_TYPES,
  DEBUG_ACTION_TYPES,
  DEBUG_QUERY_KINDS,
  buildDeployUnitAction,
  buildPlaySkillAction,
  buildEquipEquipmentAction,
  buildSwitchPositionAction,
  buildUseAbilityAction,
  buildGenerateFireChargeAction,
  buildPassTurnAction,
  buildDecision,
  buildDeckSelect,
  buildDebugAction,
  buildDebugQuery,
  buildDebugFirehose,
  buildDebugRestart,
} from "../../game/actions.js";

describe("outbound action builders", () => {
  test("every action type keeps its wire name", () => {
    expect(ACTION_TYPES.DEPLOY_UNIT).toBe("deploy-unit-action");
    expect(ACTION_TYPES.PLAY_SKILL).toBe("play-skill-action");
    expect(ACTION_TYPES.EQUIP_EQUIPMENT).toBe("equip-equipment-action");
    expect(ACTION_TYPES.SWITCH_POSITION).toBe("switch-position-action");
    expect(ACTION_TYPES.USE_ABILITY).toBe("use-ability-action");
    expect(ACTION_TYPES.GENERATE_FIRE_CHARGE).toBe("generate-fire-charge-action");
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

  test("buildGenerateFireChargeAction returns the exact payload", () => {
    expect(buildGenerateFireChargeAction()).toEqual({ type: "generate-fire-charge-action", data: {} });
  });

  test("buildPassTurnAction returns the exact payload", () => {
    expect(buildPassTurnAction()).toEqual({ type: "pass-turn-action", data: {} });
  });

  test("buildDecision returns the exact payload", () => {
    expect(buildDecision("decision-1", [77])).toEqual({ decisionId: "decision-1", choices: [77] });
    expect(() => buildDecision("decision-1", null)).toThrow(TypeError);
  });

  test("buildDeckSelect returns the exact payload", () => {
    expect(buildDeckSelect("deck-abc")).toEqual({ deckId: "deck-abc" });
    expect(() => buildDeckSelect("")).toThrow(TypeError);
    expect(() => buildDeckSelect(null)).toThrow(TypeError);
  });
});

describe("outbound dev console builders", () => {
  test("every debug action type keeps its wire name", () => {
    expect(DEBUG_ACTION_TYPES.DRAW).toBe("debug-draw-action");
    expect(DEBUG_ACTION_TYPES.ADD_TO_HAND).toBe("debug-add-to-hand-action");
    expect(DEBUG_ACTION_TYPES.ADD_TO_DECK).toBe("debug-add-to-deck-action");
    expect(DEBUG_ACTION_TYPES.SHUFFLE_DECK).toBe("debug-shuffle-deck-action");
    expect(DEBUG_ACTION_TYPES.MULLIGAN).toBe("debug-mulligan-action");
    expect(DEBUG_ACTION_TYPES.GRANT_SHINSU).toBe("debug-grant-shinsu-action");
    expect(DEBUG_ACTION_TYPES.END_ROUND).toBe("debug-end-round-action");
    expect(DEBUG_ACTION_TYPES.FORCE_TURN).toBe("debug-force-turn-action");
    expect(DEBUG_ACTION_TYPES.SET_ROUND).toBe("debug-set-round-action");
    expect(DEBUG_ACTION_TYPES.SPAWN_UNIT).toBe("debug-spawn-unit-action");
    expect(DEBUG_ACTION_TYPES.UNIT_HP).toBe("debug-unit-hp-action");
    expect(DEBUG_ACTION_TYPES.DESTROY_UNIT).toBe("debug-destroy-unit-action");
    expect(DEBUG_ACTION_TYPES.LIGHTHOUSES).toBe("debug-lighthouses-action");
  });

  test("the query kinds keep their wire names", () => {
    expect(DEBUG_QUERY_KINDS).toEqual({
      HAND: "hand",
      DECK: "deck",
      UNIT_ABILITIES: "unit-abilities",
      STATE: "state",
      LOGS: "logs",
    });
  });

  test("buildDebugAction copies the arguments and never stamps an identity", () => {
    const data = { username: "Bob", amount: 2 };
    const action = buildDebugAction(DEBUG_ACTION_TYPES.DRAW, data);

    expect(action).toEqual({ type: "debug-draw-action", data: { username: "Bob", amount: 2 } });
    expect(action.data).not.toBe(data);
    expect(action.data.source).toBeUndefined();
    expect(action.data.requestedBy).toBeUndefined();
    expect(() => buildDebugAction("")).toThrow(TypeError);
  });

  test("buildDebugQuery carries the request id and only the arguments it has", () => {
    expect(buildDebugQuery("hand", "q1", { username: "Bob" })).toEqual({
      kind: "hand",
      requestId: "q1",
      username: "Bob",
    });
    expect(buildDebugQuery("state", "q2")).toEqual({ kind: "state", requestId: "q2" });
    expect(buildDebugQuery("unit-abilities", "q3", { unitId: "unit-1" })).toEqual({
      kind: "unit-abilities",
      requestId: "q3",
      unitId: "unit-1",
    });
    expect(() => buildDebugQuery("", "q1")).toThrow(TypeError);
    expect(() => buildDebugQuery("hand", "")).toThrow(TypeError);
  });

  test("buildDebugFirehose and buildDebugRestart return the exact payloads", () => {
    expect(buildDebugFirehose(true)).toEqual({ enabled: true });
    expect(buildDebugFirehose(false)).toEqual({ enabled: false });
    expect(() => buildDebugFirehose("on")).toThrow(TypeError);
    expect(buildDebugRestart()).toEqual({});
  });
});
