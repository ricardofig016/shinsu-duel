import EVT from "../EventCatalog.js";

/**
 * Authoritative service for card cost compression.
 *
 * Compression reduces a card instance's shinsu cost. It is tracked per
 * card instance and cleaned up when the card leaves hand (play, discard).
 *
 * Compression is additive per card instance so multiple source effects stack.
 * Cleanup resets to 0 so the card returns to base cost in the discard pile.
 */
export default class CompressionService {
  /**
   * Reduce a card's cost by an amount. Emits shinsu:compressed child event.
   *
   * @param {Card} card — card instance in hand
   * @param {number} amount — positive integer
   * @param {object} context — EventBus EventContext for emitChild
   * @returns {{ compressed: number, totalReduction: number }}
   */
  static compress(card, amount, context) {
    if (!card) throw new Error("CompressionService: card is required");
    if (typeof amount !== "number" || amount <= 0) {
      throw new Error("CompressionService: amount must be a positive number");
    }

    card.costReduction = (card.costReduction || 0) + amount;

    if (context) {
      context.emitChild(EVT.SHINSU_COMPRESSED, {
        targetCardId: card.id,
        cardName: card.name,
        amount,
        totalReduction: card.costReduction,
      });
    }

    return { compressed: amount, totalReduction: card.costReduction };
  }

  /**
   * Get the current compression for this card instance.
   */
  static getReduction(card) {
    return card?.costReduction || 0;
  }

  /**
   * Reset compression when a card leaves hand.
   */
  static clearReduction(card) {
    if (card) card.costReduction = 0;
  }
}
