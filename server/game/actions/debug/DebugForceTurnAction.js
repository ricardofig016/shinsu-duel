import DebugAction from "./DebugAction.js";

/**
 * Hand the turn to the other player through the normal turn lifecycle. The
 * pass flag is cleared, so forcing a turn never ends the round.
 */
export default class DebugForceTurnAction extends DebugAction {
  execute(data, gameState) {
    gameState.forceTurn();
  }
}
