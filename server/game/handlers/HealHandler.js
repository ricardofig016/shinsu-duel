import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import TargetResolver from "../TargetResolver.js";

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
    if (!payload.targetId && !payload.target) {
      throw new Error("HealHandler: payload.targetId or payload.target is required");
    }
  }

  execute(payload, context, gameState) {
    const { amount } = payload;

    // Resolve target — use TargetResolver if target descriptor provided
    let targetId = payload.targetId;
    if (!targetId && payload.target) {
      const sourceUnit = payload.sourceUnit || gameState._findUnit(payload.sourceId);
      const targets = TargetResolver.resolveTargets(gameState, {
        target: payload.target,
        sourceUnit,
        sourceOwner: payload.sourceOwner || payload.owner,
        count: payload.count || 1,
      });
      if (targets.length === 0) return { healed: 0 };
      targetId = targets[0].id;
    }
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
