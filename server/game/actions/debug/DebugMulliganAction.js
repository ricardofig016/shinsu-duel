import DebugAction from "./DebugAction.js";
import { DECK_PLACEMENTS } from "./DebugAddToDeckAction.js";
import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

/**
 * Mulligan a seat's hand: every card in hand goes back into the deck, the deck
 * is shuffled with the game's seeded RNG, and `amount` cards are drawn. An
 * empty deck mid-draw keeps the engine's exhaustion semantics.
 */
export default class DebugMulliganAction extends DebugAction {
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

    const returned = player.hand.length;
    for (let index = 0; index < returned; index++) {
      const card = ZoneService.removeFromHand(player, 0);
      if (!card) break;
      ZoneService.addToDeck(player, card, DECK_PLACEMENTS.TOP);
    }
    ZoneService.shuffleDeck(player, gameState._rng);

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
