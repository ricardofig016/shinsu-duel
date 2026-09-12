import DebugAction from "./DebugAction.js";
import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

/**
 * Draw cards from a seat's deck, announcing each draw like the per-round draw
 * does. An empty deck keeps the engine's exhaustion semantics: losing the game.
 */
export default class DebugDrawAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
    amount: "number",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);
    DebugAction.requireInteger(data.amount, "amount");
  }

  execute(data, gameState) {
    const player = gameState.playerStates[data.username];
    const { cards: drawn } = ZoneService.draw(player, data.amount, gameState);

    for (const card of drawn) {
      gameState.eventBus.emit(EVT.CARD_DRAWN, {
        owner: data.username,
        cardId: card.cardId,
        cardName: card.name,
        card,
        handSize: player.hand.length,
        deckSize: player.deck.length,
      });
    }
  }
}
