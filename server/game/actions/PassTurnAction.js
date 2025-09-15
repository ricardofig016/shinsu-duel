import ActionHandler from "../ActionHandler.js";

export default class PassTurnAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data) {
    super.validate(data);
    const { username } = data;
    const playerState = this.gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (this.gameState.currentTurn !== username) throw new Error("It's not your turn.");
  }

  execute(data) {
    const { username } = data;
    this.gameState.endTurn(true);
  }
}
