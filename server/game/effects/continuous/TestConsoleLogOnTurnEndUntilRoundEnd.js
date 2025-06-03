export default class TestConsoleLogOnTurnEndUntilRoundEnd {
  /**
   * @param {GameState} gameState
   * This is a testing effect that logs a message to the console
   * every time a player's turn ends, until the round ends.
   */
  constructor(gameState) {
    this.gameState = gameState;
    this.onEndTurnUnsub = this.gameState.eventBus.subscribe("OnTurnEnd", this.#onEndTurn.bind(this));
    this.onEndRoundUnsub = this.gameState.eventBus.subscribe("OnRoundEnd", this.#onEndRound.bind(this));
  }

  #onEndTurn(payload) {
    console.log("this continuous effect as triggered on turn end");
    // to inspect payload, use: payload.username, payload.round, etc
  }

  #onEndRound(payload) {
    this.gameState.removeEffect(this);
  }

  unsubscribeAll() {
    // Defensive: if these unsubs are already called, they do nothing
    if (this.onEndTurnUnsub) {
      this.onEndTurnUnsub();
      this.onEndTurnUnsub = null;
    }
    if (this.onEndRoundUnsub) {
      this.onEndRoundUnsub();
      this.onEndRoundUnsub = null;
    }
  }
}
