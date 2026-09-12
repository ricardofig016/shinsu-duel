import DebugAction from "./DebugAction.js";
import ZoneService from "../../services/ZoneService.js";

/**
 * Shuffle a seat's deck with the game's seeded RNG, so the shuffle stays
 * deterministic and replayable.
 */
export default class DebugShuffleDeckAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);
  }

  execute(data, gameState) {
    ZoneService.shuffleDeck(gameState.playerStates[data.username], gameState._rng);
  }
}
