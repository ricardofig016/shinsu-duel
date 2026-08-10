import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import TargetResolver from "../TargetResolver.js";

/**
 * Applies a condition to a target unit via the ModifierStack.
 *
 * Payload:
 *   { sourceId, targetId, condition, amount?, sourceType? }
 *
 * Conditions are tracked by source and last until the end of the round.
 * Cleanse removes them.
 */
export default class GiveConditionHandler extends BaseHandler {
  validate(payload) {
    // targetId is optional — can also use target descriptor + sourceUnit
    if (!payload.targetId && !payload.target) {
      throw new Error("GiveConditionHandler: payload.targetId or payload.target is required");
    }
    if (!payload.condition) throw new Error("GiveConditionHandler: payload.condition is required");
    if (!payload.sourceId) throw new Error("GiveConditionHandler: payload.sourceId is required");
  }

  execute(payload, context, gameState) {
    const { sourceId, condition, amount = 1, sourceType = "unit" } = payload;

    // Resolve target — use TargetResolver if target descriptor provided
    let targetId = payload.targetId;
    if (!targetId && payload.target) {
      const sourceUnit = payload.sourceUnit || gameState._findUnit(payload.sourceId);
      const targets = TargetResolver.resolveTargets(gameState, {
        target: payload.target,
        sourceUnit,
        sourceOwner: payload.sourceOwner || payload.owner,
        condition: payload.conditionFilter,
        conditionValue: payload.conditionValue,
        trait: payload.trait,
        rank: payload.rank,
        position: payload.position,
        count: payload.count || 1,
      });
      if (targets.length === 0) return { blocked: true, reason: "no targets" };
      targetId = targets[0].id;
    }
    if (!targetId) return { blocked: true, reason: "no target" };

    // Check if target is Immune
    if (gameState.modifierStack.has(targetId, "trait", "immune")) {
      context.emitChild(EVT.CONDITION_BLOCKED, {
        targetId,
        condition,
        reason: "immune",
      });
      return { blocked: true };
    }

    const mod = gameState.modifierStack.apply({
      sourceId,
      sourceType,
      targetId,
      type: "condition",
      key: condition,
      value: amount,
      operation: "add",
    });

    context.emitChild(EVT.CONDITION_APPLIED, {
      targetId,
      condition,
      amount,
      sourceId,
    });

    return { modifierId: mod.id };
  }
}
