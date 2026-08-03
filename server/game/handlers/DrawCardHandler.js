import BaseHandler from "./BaseHandler.js";

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
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("DrawCardHandler: payload.amount must be a positive number");
    }
    if (!payload.owner) {
      throw new Error("DrawCardHandler: payload.owner is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const drawn = [];

    for (let i = 0; i < amount; i++) {
      if (player.deck.length === 0) {
        // Deck empty — player loses
        context.emitChild("game:deck:empty", { owner });
        break;
      }

      const card = player.deck.pop();
      player.hand.push(card);
      drawn.push(card);

      context.emitChild("card:drawn", {
        owner,
        cardId: card.cardId,
        cardName: card.name,
        handSize: player.hand.length,
        deckSize: player.deck.length,
      });
    }

    return { drawn: drawn.length, cards: drawn };
  }
}
