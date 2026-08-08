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
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("ReclaimCardsHandler: payload.amount must be a positive number");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

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
      });
    }

    return { reclaimed, cards };
  }
}
