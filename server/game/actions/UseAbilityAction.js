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

    return true;
  }

  execute(data, gameState) {
    const { username, unitId, abilityCode } = data;
    const playerState = gameState.playerStates[username];
    const unit = [...playerState.field.frontline, ...playerState.field.backline].find((u) => u.id === unitId);
    unit.useAbility(abilityCode, null, gameState);
  }
}
