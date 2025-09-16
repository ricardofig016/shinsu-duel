import ActionHandler from "../ActionHandler.js";

/**
 * Deploy a unit from a player's hand to a specified position on the board.
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
    const playerState = gameState.playerStates[username];
    playerState.lighthouses.amount += amount;
    gameState.eventBus.publish("OnAddLighthouses", { username, amount });
  }
}
