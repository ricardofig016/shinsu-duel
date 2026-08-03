import BaseHandler from "./BaseHandler.js";

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
    if (!payload.targetId) throw new Error("GiveConditionHandler: payload.targetId is required");
    if (!payload.condition) throw new Error("GiveConditionHandler: payload.condition is required");
    if (!payload.sourceId) throw new Error("GiveConditionHandler: payload.sourceId is required");
  }

  execute(payload, context, gameState) {
    const { sourceId, targetId, condition, amount = 1, sourceType = "unit" } = payload;

    // Check if target is Immune
    if (gameState.modifierStack.has(targetId, "trait", "immune")) {
      context.emitChild("state:condition:blocked", {
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

    context.emitChild("state:condition:applied", {
      targetId,
      condition,
      amount,
      sourceId,
    });

    return { modifierId: mod.id };
  }
}
