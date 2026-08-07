import ActionHandler from "../ActionHandler.js";

/** Activates the built-in Hwayeomsa core ability. */
export default class GenerateFireChargeAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    if (!gameState.playerStates[data.username]) throw new Error(`Player ${data.username} not found.`);
    if (gameState.currentTurn !== data.username) throw new Error("It's not your turn.");
  }

  execute(data, gameState) {
    const engine = gameState._attributeRegistry.get("hwayeomsa");
    const result = engine.generateFireCharge(data.username, gameState);
    if (!result.success) throw new Error(result.reason);
  }
}
