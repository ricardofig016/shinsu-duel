import BaseHandler from "./BaseHandler.js";

/**
 * Moves cards from the player's discard pile to their hand.
 *
 * Payload:
 *   { owner, amount }
 *
 * Cards are taken from the top of the discard pile (last discarded first).
 * If the discard pile has fewer cards than requested, all available cards
 * are moved.
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

    // Discard pile may not exist yet (Phase 3 adds it)
    if (!player.discard || !Array.isArray(player.discard)) {
      return { reclaimed: 0, cards: [] };
    }

    const toReclaim = Math.min(amount, player.discard.length);
    const cards = player.discard.splice(player.discard.length - toReclaim, toReclaim);

    // Move to hand
    for (const card of cards.reverse()) {
      player.hand.push(card);
      context.emitChild("card:reclaimed", {
        owner,
        cardId: card.cardId,
        cardName: card.name,
      });
    }

    return { reclaimed: cards.length, cards };
  }
}
