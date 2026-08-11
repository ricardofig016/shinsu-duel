import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Removes all conditions from a target unit.
 *
 * Payload:
 *   { targetId }
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class CleanseHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) {
      throw new Error("CleanseHandler: payload.targetId is required");
    }
  }

  execute(payload, context, gameState) {
    const { targetId } = payload;

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
