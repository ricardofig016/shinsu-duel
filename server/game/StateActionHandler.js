export default class ActionHandler {
  constructor(gameState) {
    this.gameState = gameState; // Reference to the GameState instance
  }

  validate(data) {
    throw new Error("validate() must be implemented in subclasses");
  }

  execute(data) {
    throw new Error("execute() must be implemented in subclasses");
  }
}
