import BaseHandler from "./BaseHandler.js";

/**
 * Heals a unit by the specified amount, capped at max HP.
 *
 * Payload:
 *   { targetId, amount }
 */
export default class HealHandler extends BaseHandler {
  validate(payload) {
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("HealHandler: payload.amount must be a positive number");
    }
    if (!payload.targetId) {
      throw new Error("HealHandler: payload.targetId is required");
    }
  }

  execute(payload, context, gameState) {
    const { targetId, amount } = payload;
    const unit = gameState._findUnit(targetId);
    if (!unit || !unit.isAlive()) return { healed: 0 };

    const maxHp = unit.card.maxHp;
    const healAmount = Math.min(amount, maxHp - unit.currentHp);

    if (healAmount > 0) {
      unit.currentHp += healAmount;
      context.emitChild("unit:heal:applied", {
        targetId,
        amount: healAmount,
        currentHp: unit.currentHp,
      });
    }

    return { healed: healAmount };
  }
}
