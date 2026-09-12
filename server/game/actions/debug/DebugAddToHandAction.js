import DebugAction from "./DebugAction.js";
import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

/**
 * Create a card from the compiled catalog and put it in a seat's hand, the
 * same way a `create_card` effect does.
 */
export default class DebugAddToHandAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
    cardId: "number",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);
    this.buildCard(data, gameState, data.username);
  }

  execute(data, gameState) {
    const card = this.buildCard(data, gameState, data.username);
    ZoneService.addToHand(gameState.playerStates[data.username], card);
    gameState.eventBus.emit(EVT.CARD_CREATED, {
      owner: data.username,
      cardId: card.cardId,
      name: card.name,
    });
  }
}
