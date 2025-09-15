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

  validate(data) {
    super.validate(data);
    const { username, unitId, abilityCode } = data;
    const playerState = this.gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (this.gameState.currentTurn !== username) throw new Error("It's not your turn.");

    const unit = [...playerState.field.frontline, ...playerState.field.backline].find((u) => u.id === unitId);
    if (!unit) throw new Error(`Unit ${unitId} not found in your field.`);

    return true;
  }

  execute(data) {
    const { username, unitId, abilityCode } = data;
    const playerState = this.gameState.playerStates[username];
    const unit = [...playerState.field.frontline, ...playerState.field.backline].find((u) => u.id === unitId);
    unit.useAbility(abilityCode, null);
  }
}
