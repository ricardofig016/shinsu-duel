import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import TargetResolver from "../TargetResolver.js";

/**
 * Removes all conditions from a target unit.
 *
 * Payload:
 *   { targetId }  or  { target, sourceUnit, sourceOwner }
 *
 * Accepts target descriptors ("self", "ally", "enemy", "unit")
 * resolved through TargetResolver.
 */
export default class CleanseHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId && !payload.target) {
      throw new Error("CleanseHandler: payload.targetId or payload.target is required");
    }
  }

  execute(payload, context, gameState) {
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
      if (targets.length === 0) return { cleansed: [] };
      targetId = targets[0].id;
    }
    if (!targetId) return { cleansed: [] };

    const modStack = gameState.modifierStack;

    const conditions = modStack.getModifiers(targetId, "condition");
    const removed = [];

    for (const mod of conditions) {
      removed.push({ condition: mod.key, amount: mod.value, sourceId: mod.sourceId });
    }

    modStack.removeWhere(
      (m) => m.targetId === targetId && m.type === "condition"
    );

    if (removed.length > 0) {
      context.emitChild(EVT.CONDITION_CLEANSED, {
        targetId,
        removed,
      });
    }

    return { cleansed: removed };
  }
}
