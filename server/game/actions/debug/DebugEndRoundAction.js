import DebugAction from "./DebugAction.js";

/**
 * End the current round immediately, without flipping the turn. The round
 * processing a round-ending pass runs (round end, shinsu reset, per-round
 * draw, round start) is unchanged; only the two-pass pass flag is reset, so
 * the next pass in the new round behaves normally.
 */
export default class DebugEndRoundAction extends DebugAction {
  execute(data, gameState) {
    gameState.endRoundNow();
  }
}
