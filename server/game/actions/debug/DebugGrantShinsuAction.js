import DebugAction from "./DebugAction.js";
import ShinsuService from "../../services/ShinsuService.js";
import EVT from "../../EventCatalog.js";

/**
 * Grant shinsu to a seat's normal pool. It goes through `ShinsuService.gain`,
 * so the RULES.md cap (the round number, up to 10) applies as it does for
 * every other shinsu source.
 */
export default class DebugGrantShinsuAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
    amount: "number",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);
    DebugAction.requireInteger(data.amount, "amount", { min: 1 });
  }

  execute(data, gameState) {
    const player = gameState.playerStates[data.username];
    const { gained } = ShinsuService.gain(player, data.amount, gameState.round);

    gameState.eventBus.emit(EVT.SHINSU_CHARGED, {
      owner: data.username,
      amount: gained,
      total: player.shinsu.normalAvailable + player.shinsu.recharged,
    });
  }
}
