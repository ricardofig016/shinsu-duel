export default class TestConsoleLogOnTurnEnd {
  /**
   * @param {GameState} gameState
   * This is a testing effect triggers once when a player's turn ends.
   * It logs a message to the console and then removes itself.
   */
  constructor(gameState) {
    this.gameState = gameState;
    this.onEndTurnUnsub = this.gameState.eventBus.subscribe("OnEndTurn", this.#onEndTurn.bind(this));
  }

  #onEndTurn(payload) {
    console.log("this triggered effect as triggered on turn end");
    if (this.onEndTurnUnsub) {
      this.onEndTurnUnsub();
      this.onEndTurnUnsub = null;
    }
    this.gameState.removeEffect(this);
  }

  unsubscribeAll() {
    if (this.onEndTurnUnsub) {
      this.onEndTurnUnsub();
      this.onEndTurnUnsub = null;
    }
  }
}
