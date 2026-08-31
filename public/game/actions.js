/**
 * Outbound game action and decision payload builders.
 *
 * Every message the client emits goes through one of these builders, so the
 * wire payloads have a single client-side definition. The server stamps the
 * authenticated identity onto accepted actions; the client never sends one.
 */

export const ACTION_TYPES = Object.freeze({
  DEPLOY_UNIT: "deploy-unit-action",
  PLAY_SKILL: "play-skill-action",
  EQUIP_EQUIPMENT: "equip-equipment-action",
  SWITCH_POSITION: "switch-position-action",
  USE_ABILITY: "use-ability-action",
  PASS_TURN: "pass-turn-action",
});

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

function assertHandId(handId) {
  if (!Number.isInteger(handId) || handId < 0) {
    throw new TypeError("handId must be a non-negative integer.");
  }
}

const buildAction = (type, data) => ({ type, data });

export function buildDeployUnitAction(handId, placedPositionCode) {
  assertHandId(handId);
  assertNonEmptyString(placedPositionCode, "placedPositionCode");
  return buildAction(ACTION_TYPES.DEPLOY_UNIT, { handId, placedPositionCode });
}

export function buildPlaySkillAction(handId) {
  assertHandId(handId);
  return buildAction(ACTION_TYPES.PLAY_SKILL, { handId });
}

export function buildEquipEquipmentAction(handId, targetUnitId) {
  assertHandId(handId);
  assertNonEmptyString(targetUnitId, "targetUnitId");
  return buildAction(ACTION_TYPES.EQUIP_EQUIPMENT, { handId, targetUnitId });
}

export function buildSwitchPositionAction(unitId, positionCode) {
  assertNonEmptyString(unitId, "unitId");
  assertNonEmptyString(positionCode, "positionCode");
  return buildAction(ACTION_TYPES.SWITCH_POSITION, { unitId, positionCode });
}

export function buildUseAbilityAction(unitId, abilityCode) {
  assertNonEmptyString(unitId, "unitId");
  assertNonEmptyString(abilityCode, "abilityCode");
  return buildAction(ACTION_TYPES.USE_ABILITY, { unitId, abilityCode });
}

export function buildPassTurnAction() {
  return buildAction(ACTION_TYPES.PASS_TURN, {});
}

/**
 * Build the decision-resolution payload. `choices` is the full selection
 * (pre-locked candidates included); the engine validates the count and the
 * candidate ids.
 */
export function buildDecision(decisionId, choices) {
  assertNonEmptyString(decisionId, "decisionId");
  if (!Array.isArray(choices)) throw new TypeError("choices must be an array.");
  return { decisionId, choices: [...choices] };
}
