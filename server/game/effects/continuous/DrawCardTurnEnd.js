export default class DrawCardTurnEnd {
  /**
   * @param {GameState} gameState
   * @param {string} owner - the username of the player who owns this effect
   * This is a testing effect that draws a card for the player
   * every time a turn ends.
   */
  constructor(gameState, owner) {
    this.gameState = gameState;
    this.owner = owner;
    this.onTurnEndUnsub = this.gameState.eventBus.subscribe("OnTurnEnd", this.#onTurnEnd.bind(this));
  }

  #onTurnEnd(payload) {
    console.log("this continuous effect as triggered on turn end");
    // to inspect payload, use: payload.username, payload.round, etc
  }

  unsubscribeAll() {
    // Defensive: if these unsubs are already called, they do nothing
    if (this.onTurnEndUnsub) {
      this.onTurnEndUnsub();
      this.onTurnEndUnsub = null;
    }
  }
}
