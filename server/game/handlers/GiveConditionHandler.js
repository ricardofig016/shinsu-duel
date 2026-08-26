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
    const result = GiveConditionHandler.applyCondition(payload, gameState);
    if (result.blocked) {
      context.emitChild(EVT.CONDITION_BLOCKED, {
        targetId: payload.targetId,
        condition: payload.condition,
        reason: result.reason,
      });
      return result;
    }
    context.emitChild(EVT.CONDITION_APPLIED, {
      targetId: payload.targetId,
      condition: payload.condition,
      amount: result.appliedAmount,
      sourceId: payload.sourceId,
    });
    return { modifierId: result.modifierId };
  }

  /**
   * Authoritative condition-application path, shared by ordinary
   * `give_condition` effects and `GlobalRuleRegistry`'s continuous
   * `grant_global_condition` reconciliation. Honors Immune, the source's
   * `modify_condition` amplifier, and any active `condition_stack_cap`.
   *
   * Does not emit CONDITION_APPLIED/CONDITION_BLOCKED — callers with an
   * EventBus context should emit those themselves (see `execute` above);
   * callers without one (landmark reconciliation) apply state silently,
   * consistent with a continuous board rule rather than a discrete effect.
   *
   * @returns {{ blocked: true, reason: string } | { blocked: false, appliedAmount: number, modifierId: string }}
   */
  static applyCondition(payload, gameState) {
    const { sourceId, condition, targetId, amount = 1, sourceType = "unit", meta = null } = payload;
    if (!targetId) return { blocked: true, reason: "no target" };

    if (gameState.modifierStack.has(targetId, "trait", "immune")) {
      return { blocked: true, reason: "immune" };
    }

    // Always-on `modify_condition` amplifier: the source applies extra stacks
    // of this condition to matching targets (e.g. "i give Poisoned +2").
    const sourceUnit = payload.sourceUnit || gameState._findUnit?.(sourceId);
    const targetUnit = gameState._findUnit?.(targetId);
    const amplified = amount + gameState.modifierStack.getConditionAmplifier(sourceUnit, targetUnit, condition);
    const cap = gameState._globalRuleRegistry?.getConditionCap(targetUnit, condition, gameState);
    const current = gameState.modifierStack.getEffective(targetId, "condition", condition);
    const appliedAmount = cap == null ? amplified : Math.max(0, Math.min(amplified, cap - current));
    if (appliedAmount <= 0) return { blocked: true, reason: "condition cap" };

    const mod = gameState.modifierStack.apply({
      sourceId,
      sourceType,
      targetId,
      type: "condition",
      key: condition,
      value: appliedAmount,
      operation: "add",
      meta,
    });

    return { blocked: false, appliedAmount, modifierId: mod.id };
  }
}
