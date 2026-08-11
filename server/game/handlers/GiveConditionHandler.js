import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Applies a condition to a target unit via the ModifierStack.
 *
 * Payload:
 *   { sourceId, targetId, condition, amount?, sourceType? }
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class GiveConditionHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) {
      throw new Error("GiveConditionHandler: payload.targetId is required");
    }
    if (!payload.condition) throw new Error("GiveConditionHandler: payload.condition is required");
    if (!payload.sourceId) throw new Error("GiveConditionHandler: payload.sourceId is required");
  }

  execute(payload, context, gameState) {
    const { sourceId, condition, targetId, amount = 1, sourceType = "unit" } = payload;
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
