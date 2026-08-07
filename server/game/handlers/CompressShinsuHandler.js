import BaseHandler from "./BaseHandler.js";

/**
 * Reduces the shinsu cost of one card instance in its owner's hand.
 *
 * Payload:
 *   { owner, amount, targetCardId? | targetCardSelector? }
 */
export default class CompressShinsuHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("CompressShinsuHandler: payload.owner is required");
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("CompressShinsuHandler: payload.amount must be a positive number");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount, targetCardId, targetCardSelector } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const selector = targetCardSelector?.toLowerCase();
    const target = targetCardId
      ? player.hand.find((card) => card.id === targetCardId)
      : selector === "the most expensive card"
        ? player.hand.reduce((mostExpensive, card) =>
          !mostExpensive || card.cost > mostExpensive.cost ? card : mostExpensive, null)
        : selector?.startsWith("a ")
          ? player.hand.find((card) => card.attributes?.includes(selector.slice(2).replaceAll(" ", "-")))
          : selector
            ? player.hand.find((card) => card.name.toLowerCase() === selector)
            : null;
    if (!target) {
      throw new Error("CompressShinsuHandler: a card in the owner's hand must be selected");
    }

    target.costReduction = (target.costReduction || 0) + amount;
    context.emitChild("shinsu:compressed", {
      owner,
      targetCardId: target.id,
      cardName: target.name,
      amount,
      totalReduction: target.costReduction,
    });

    return { compressed: amount, targetCardId: target.id, totalReduction: target.costReduction };
  }
}
