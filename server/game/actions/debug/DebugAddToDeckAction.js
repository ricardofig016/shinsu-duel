import DebugAction from "./DebugAction.js";
import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

/** Placements a debug command may insert a card at. */
export const DECK_PLACEMENTS = Object.freeze({ TOP: "top", BOTTOM: "bottom" });

/**
 * Create a card from the compiled catalog and insert it into a seat's deck,
 * on top (the next card drawn) or at the bottom.
 */
export default class DebugAddToDeckAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
    cardId: "number",
    placement: "string",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);
    this.buildCard(data, gameState, data.username);
    if (data.placement !== DECK_PLACEMENTS.TOP && data.placement !== DECK_PLACEMENTS.BOTTOM) {
      throw new Error(`placement must be "${DECK_PLACEMENTS.TOP}" or "${DECK_PLACEMENTS.BOTTOM}".`);
    }
  }

  execute(data, gameState) {
    const card = this.buildCard(data, gameState, data.username);
    ZoneService.addToDeck(gameState.playerStates[data.username], card, data.placement);
    gameState.eventBus.emit(EVT.CARD_CREATED, {
      owner: data.username,
      cardId: card.cardId,
      name: card.name,
    });
  }
}
