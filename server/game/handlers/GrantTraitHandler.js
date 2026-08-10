import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Grants a trait to a target unit via the ModifierStack.
 *
 * Payload:
 *   { sourceId, targetId, trait, amount?, sourceType? }
 *
 * The modifier is tracked by sourceId so it can be removed when the
 * source (e.g. equipment) is removed.
 */
export default class GrantTraitHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("GrantTraitHandler: payload.targetId is required");
    if (!payload.trait) throw new Error("GrantTraitHandler: payload.trait is required");
    if (!payload.sourceId) throw new Error("GrantTraitHandler: payload.sourceId is required");
  }

  execute(payload, context, gameState) {
    const { sourceId, targetId, trait, amount = 1, sourceType = "system" } = payload;

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
