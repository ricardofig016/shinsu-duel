import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Removes traits from a target unit (Silence).
 *
 * DSL type: remove_traits
 *
 * Removes all trait modifiers, or a single named `trait`. Per RULES.md,
 * Silence removes traits at the moment it is applied — traits granted later
 * are unaffected, so this REMOVES (not disables) trait modifiers.
 *
 * Payload:
 *   { targetId, trait? }
 */
export default class RemoveTraitsHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("RemoveTraitsHandler: payload.targetId is required");
  }

  execute(payload, context, gameState) {
    const { targetId, trait } = payload;
    const modStack = gameState.modifierStack;

    const removed = modStack
      .getModifiers(targetId, "trait")
      .filter((m) => (trait === undefined || m.key === trait))
      .map((m) => ({ trait: m.key, sourceId: m.sourceId }));

    modStack.removeWhere(
      (m) =>
        m.targetId === targetId &&
        m.type === "trait" &&
        (trait === undefined || m.key === trait)
    );

    if (removed.length > 0) {
      context.emitChild(EVT.UNIT_SILENCED, { targetId, removed });
    }

    return { removed };
  }
}
