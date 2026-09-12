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
  GENERATE_FIRE_CHARGE: "generate-fire-charge-action",
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

export function buildGenerateFireChargeAction() {
  return buildAction(ACTION_TYPES.GENERATE_FIRE_CHARGE, {});
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

/**
 * Build the pre-game deck-selection payload. `deckId` is the id of one of
 * the sender's own decks in the deck collection.
 */
export function buildDeckSelect(deckId) {
  assertNonEmptyString(deckId, "deckId");
  return { deckId };
}

/* ── dev console ────────────────────────────────────────────────────────── */

/**
 * Dev-console mutation types. They mirror the debug actions the engine
 * registers, which accept `source: "debug"` only: the gateway stamps that
 * source, so a player action can never carry one of these types.
 */
export const DEBUG_ACTION_TYPES = Object.freeze({
  DRAW: "debug-draw-action",
  ADD_TO_HAND: "debug-add-to-hand-action",
  ADD_TO_DECK: "debug-add-to-deck-action",
  SHUFFLE_DECK: "debug-shuffle-deck-action",
  MULLIGAN: "debug-mulligan-action",
  GRANT_SHINSU: "debug-grant-shinsu-action",
  END_ROUND: "debug-end-round-action",
  FORCE_TURN: "debug-force-turn-action",
  SET_ROUND: "debug-set-round-action",
  SPAWN_UNIT: "debug-spawn-unit-action",
  UNIT_HP: "debug-unit-hp-action",
  DESTROY_UNIT: "debug-destroy-unit-action",
  LIGHTHOUSES: "debug-lighthouses-action",
});

/** The read-only queries the server answers with a targeted `debug-result`. */
export const DEBUG_QUERY_KINDS = Object.freeze({
  HAND: "hand",
  DECK: "deck",
  UNIT_ABILITIES: "unit-abilities",
  STATE: "state",
  LOGS: "logs",
});

/**
 * Build a dev-console mutation. The target seat is part of `data`; the server
 * stamps the identity of the player who issued the command.
 */
export function buildDebugAction(type, data = {}) {
  assertNonEmptyString(type, "debug action type");
  return buildAction(type, { ...data });
}

/**
 * Build a dev-console query. `requestId` is echoed on the matching
 * `debug-result`; the server answers with `game-error` instead when it
 * refuses, so the console can drop the pending request.
 */
export function buildDebugQuery(kind, requestId, { username = null, unitId = null } = {}) {
  assertNonEmptyString(kind, "debug query kind");
  assertNonEmptyString(requestId, "requestId");

  const query = { kind, requestId };
  if (username !== null) query.username = username;
  if (unitId !== null) query.unitId = unitId;
  return query;
}

/** Build the dev-console firehose toggle payload. */
export function buildDebugFirehose(enabled) {
  if (typeof enabled !== "boolean") throw new TypeError("enabled must be a boolean.");
  return { enabled };
}

/** Build the dev-console restart message. It carries no arguments. */
export function buildDebugRestart() {
  return {};
}
