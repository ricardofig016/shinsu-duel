import DebugAction from "./DebugAction.js";

/**
 * Set the round counter directly. No round processing runs, so conditions,
 * shinsu, and the per-round draw are untouched; the next round end advances
 * from the value set here.
 */
export default class DebugSetRoundAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    round: "number",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    DebugAction.requireInteger(data.round, "round", { min: 1 });
  }

  execute(data, gameState) {
    gameState.setRound(data.round);
  }
}
