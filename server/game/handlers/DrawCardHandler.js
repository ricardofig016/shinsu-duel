import BaseHandler from "./BaseHandler.js";
import ZoneService from "../services/ZoneService.js";
import EVT from "../EventCatalog.js";

/**
 * Draws cards from a player's deck.
 *
 * Payload:
 *   { owner, amount }
 *
 * If the deck is empty, emits "game:deck:empty" which triggers loss.
 */
export default class DrawCardHandler extends BaseHandler {
  validate(payload) {
    BaseHandler.requirePositiveInt(payload.amount, "amount");
    if (!payload.owner) {
      throw new Error("DrawCardHandler: payload.owner is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    // Delegate to authoritative ZoneService
    const { drawn, cards } = ZoneService.draw(player, amount, gameState);

    for (const card of cards) {
      context.emitChild(EVT.CARD_DRAWN, {
        owner,
        cardId: card.cardId,
        cardName: card.name,
        handSize: player.hand.length,
        deckSize: player.deck.length,
      });
    }

    return { drawn, cards };
  }
}
