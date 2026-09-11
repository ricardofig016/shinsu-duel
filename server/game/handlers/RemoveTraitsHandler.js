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
 * The `unit:silenced` event carries `sourceOwner` — the player whose effect
 * caused the silence — so "when you silence an enemy" triggers can check
 * who caused it. Effects that resolve without an acting player attribute
 * the silence to nobody (`sourceOwner: null`). Each `removed` entry carries
 * the trait's `value` and whether it was `disabled`: the traits no longer
 * exist on the stack when listeners run, so the payload is the only record
 * of what the unit had at the silence moment.
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
      .map((m) => ({ trait: m.key, value: m.value, disabled: m.disabledCount > 0, sourceId: m.sourceId }));

    modStack.removeWhere(
      (m) =>
        m.targetId === targetId &&
        m.type === "trait" &&
        (trait === undefined || m.key === trait)
    );

    if (removed.length > 0) {
      context.emitChild(EVT.UNIT_SILENCED, {
        targetId,
        removed,
        sourceOwner: payload.sourceOwner || payload.owner || null,
      });
    }

    return { removed };
  }
}
