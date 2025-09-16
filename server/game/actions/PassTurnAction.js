import ActionHandler from "../ActionHandler.js";

export default class PassTurnAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    const { username } = data;
    const playerState = gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");
  }

  execute(data, gameState) {
    const { username } = data;
    gameState.endTurn(true);
  }
}
