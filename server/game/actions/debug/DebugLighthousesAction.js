import DebugAction from "./DebugAction.js";

/**
 * Change a seat's lighthouse count. The owning service applies the 0-40 clamp
 * and its game-over-at-zero behavior unchanged.
 */
export default class DebugLighthousesAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
    amount: "number",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);
    DebugAction.requireInteger(data.amount, "amount", { min: -Number.MAX_SAFE_INTEGER });
  }

  execute(data, gameState) {
    gameState.modifyLighthouses(data.username, data.amount);
  }
}
