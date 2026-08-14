import BaseHandler from "./BaseHandler.js";
import UnitService from "../services/UnitService.js";
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

    const { healed: healAmount } = UnitService.heal(unit, amount);

    if (healAmount > 0) {
      context.emitChild(EVT.HEAL_APPLIED, {
        targetId,
        amount: healAmount,
        currentHp: unit.currentHp,
      });
    }

    return { healed: healAmount };
  }
}
