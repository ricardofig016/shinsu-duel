import EVT from "../EventCatalog.js";

/**
 * Authoritative service for lighthouse management.
 *
 * Lighthouses are the player's life total. Starting at 20, capped at 40.
 * Reaching 0 lighthouses triggers game over.
 */
export default class LighthouseService {
  static MAX = 40;
  static MIN = 0;

  /**
   * Modify a player's lighthouse count.
   * Caps at 0-40, emits events, and triggers game-over at 0.
   *
   * @param {GameState} gameState
   * @param {string} username
   * @param {number} delta — positive to add, negative to remove
   * @param {object} [context] — EventBus context for emitChild
   * @returns {{ oldAmount: number, newAmount: number, delta: number }}
   */
  static modify(gameState, username, delta) {
    const player = gameState.playerStates[username];
    if (!player) throw new Error(`LighthouseService: player "${username}" not found`);

    const oldAmount = player.lighthouses?.amount ?? 0;
    player.lighthouses.amount = Math.max(LighthouseService.MIN, Math.min(LighthouseService.MAX, oldAmount + delta));
    const newAmount = player.lighthouses.amount;

    if (newAmount <= 0 && !gameState.gameOver) {
      gameState.gameOver = {
        winner: gameState.usernames.find((u) => u !== username),
        reason: "lighthouses depleted",
      };
      gameState.eventBus.emit(EVT.GAME_LIGHTHOUSES_DEPLETED, {
        loser: username,
        winner: gameState.gameOver.winner,
      });
      gameState.eventBus.emit(EVT.GAME_OVER, gameState.gameOver);
    }

    return { oldAmount, newAmount, delta: newAmount - oldAmount };
  }
}
