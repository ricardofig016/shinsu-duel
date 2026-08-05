import ActionHandler from "../ActionHandler.js";

/**
 * Use a unit's ability.
 */
export default class UseAbilityAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    unitId: "string",
    abilityCode: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    const { username, unitId, abilityCode } = data;
    const playerState = gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");

    const unit = [...playerState.field.frontline, ...playerState.field.backline].find((u) => u.id === unitId);
    if (!unit) throw new Error(`Unit ${unitId} not found in your field.`);

    // Check combat slot availability for the unit's position
    const positionCode = unit.placedPositionCode;
    const slot = playerState.combatSlots?.[positionCode];
    if (slot && !slot.available) {
      throw new Error(`Combat slot for ${positionCode} is already used this round.`);
    }

    return true;
  }

  execute(data, gameState) {
    const { username, unitId, abilityCode } = data;
    const playerState = gameState.playerStates[username];
    const unit = [...playerState.field.frontline, ...playerState.field.backline].find((u) => u.id === unitId);

    // Consume the combat slot (unless Free keyword)
    if (unit && playerState.combatSlots) {
      const positionCode = unit.placedPositionCode;
      if (playerState.combatSlots[positionCode]) {
        playerState.combatSlots[positionCode].available = false;
      }
    }

    unit.useAbility(abilityCode, null, gameState);
  }
}
