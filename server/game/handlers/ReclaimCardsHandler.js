import BaseHandler from "./BaseHandler.js";
import ZoneService from "../services/ZoneService.js";
import EVT from "../EventCatalog.js";

/**
 * Moves cards from the player's discard pile to their hand.
 *
 * Payload:
 *   { owner, amount }
 */
export default class ReclaimCardsHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("ReclaimCardsHandler: payload.owner is required");
    BaseHandler.requirePositiveInt(payload.amount, "amount");
  }

  execute(payload, context, gameState) {
    const { owner, amount, targetCardId } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    // Filtered reclaim: a specific card was pre-resolved by EffectResolver from
    // a structured `card` target. Remove it from discard and move it to hand.
    if (targetCardId) {
      const card = ZoneService.removeFromDiscard(player, targetCardId);
      if (!card) throw new Error("ReclaimCardsHandler: the target card is no longer in the owner's discard");
      ZoneService.addToHand(player, card);
      context.emitChild(EVT.CARD_RECLAIMED, {
        owner,
        cardId: card.cardId,
        cardName: card.name,
        card,
      });
      return { reclaimed: 1, cards: [card] };
    }

    const cards = [];
    let reclaimed = 0;

    // Delegate to authoritative ZoneService.reclaimTop for each card
    for (let i = 0; i < amount; i++) {
      const card = ZoneService.reclaimTop(player);
      if (!card) break;
      cards.push(card);
      reclaimed++;
      context.emitChild(EVT.CARD_RECLAIMED, {
        owner,
        cardId: card.cardId,
        cardName: card.name,
        card,
      });
    }

    return { reclaimed, cards };
  }
}
