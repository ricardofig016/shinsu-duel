import ActionHandler from "../ActionHandler.js";

/**
 * System-internal action for adding lighthouses (e.g. Creator trait).
 * Not exposed to players — only callable by system-internal processes.
 */
export default class AddLighthousesAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    amount: "number",
  };
  static sourceAccess = { player: false, system: true };

  validate(data, gameState) {
    super.validate(data);
    const { username, amount } = data;
    const playerState = gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (amount <= 0) throw new Error(`Invalid amount: ${amount}.`);

    return true;
  }

  execute(data, gameState) {
    const { username, amount } = data;
    gameState.modifyLighthouses(username, amount);
  }
}
