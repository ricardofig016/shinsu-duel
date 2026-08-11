import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import TargetResolver from "../TargetResolver.js";

/**
 * Grants a trait to a target unit via the ModifierStack.
 *
 * Payload:
 *   { sourceId, targetId, trait, amount?, sourceType? }
 *   or { sourceId, target, trait, amount?, sourceUnit, sourceOwner, sourceType? }
 *
 * Accepts target descriptors ("self", "ally", "enemy", "bearer", "unit")
 * resolved through TargetResolver.
 *
 * The modifier is tracked by sourceId so it can be removed when the
 * source (e.g. equipment) is removed.
 */
export default class GrantTraitHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId && !payload.target) {
      throw new Error("GrantTraitHandler: payload.targetId or payload.target is required");
    }
    if (!payload.trait) throw new Error("GrantTraitHandler: payload.trait is required");
    if (!payload.sourceId) throw new Error("GrantTraitHandler: payload.sourceId is required");
  }

  execute(payload, context, gameState) {
    const { sourceId, trait, amount = 1, sourceType = "system" } = payload;

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
      if (targets.length === 0) return { granted: false, reason: "no targets" };
      targetId = targets[0].id;
    }
    if (!targetId) return { granted: false, reason: "no target" };

    const mod = gameState.modifierStack.apply({
      sourceId,
      sourceType,
      targetId,
      type: "trait",
      key: trait,
      value: amount,
      operation: "add",
    });

    context.emitChild(EVT.TRAIT_GRANTED, {
      targetId,
      trait,
      amount,
      sourceId,
    });

    return { modifierId: mod.id };
  }
}
