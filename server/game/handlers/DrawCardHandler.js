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
    const { owner, amount, targetCardId } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    // Filtered draw: a specific card was pre-resolved by EffectResolver from a
    // structured `card` target. Search the deck, then draw that card.
    if (targetCardId) {
      const card = ZoneService.searchDeck(player, targetCardId, gameState._rng);
      if (!card) throw new Error("DrawCardHandler: the target card is no longer in the owner's deck");
      ZoneService.addToHand(player, card);
      context.emitChild(EVT.CARD_DRAWN, {
        owner,
        cardId: card.cardId,
        cardName: card.name,
        card,
        handSize: player.hand.length,
        deckSize: player.deck.length,
      });
      return { drawn: 1, cards: [card] };
    }

    // Delegate to authoritative ZoneService
    const { drawn, cards } = ZoneService.draw(player, amount, gameState);

    for (const card of cards) {
      context.emitChild(EVT.CARD_DRAWN, {
        owner,
        cardId: card.cardId,
        cardName: card.name,
        card,
        handSize: player.hand.length,
        deckSize: player.deck.length,
      });
    }

    return { drawn, cards };
  }
}
