import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Heals a unit by the specified amount, capped at max HP.
 *
 * Payload:
 *   { targetId, amount }
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class HealHandler extends BaseHandler {
  validate(payload) {
    BaseHandler.requirePositiveInt(payload.amount, "amount");
    if (!payload.targetId) {
      throw new Error("HealHandler: payload.targetId is required");
    }
  }

  execute(payload, context, gameState) {
    const { amount, targetId } = payload;
    if (!targetId) return { healed: 0 };

    const unit = gameState._findUnit(targetId);
    if (!unit || !unit.isAlive()) return { healed: 0 };

    const maxHp = unit.card.maxHp;
    const healAmount = Math.min(amount, maxHp - unit.currentHp);

    if (healAmount > 0) {
      unit.currentHp += healAmount;
      context.emitChild(EVT.HEAL_APPLIED, {
        targetId,
        amount: healAmount,
        currentHp: unit.currentHp,
      });
    }

    return { healed: healAmount };
  }
}
