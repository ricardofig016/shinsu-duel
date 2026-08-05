import BaseHandler from "./BaseHandler.js";

/**
 * Registers a new ability on a target unit.
 *
 * DSL type: grant_ability
 * Inner `ability` DSL is NOT executed immediately — it's registered as an
 * event-triggered ability on the target unit.
 *
 * Payload:
 *   { sourceId, targetId, ability }
 *
 * The ability is tracked via ModifierStack so it is removed when the
 * source (e.g., equipment) is removed.
 */
export default class GrantAbilityHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("GrantAbilityHandler: payload.targetId is required");
    if (!payload.sourceId) throw new Error("GrantAbilityHandler: payload.sourceId is required");
    if (!payload.ability || typeof payload.ability !== "object") {
      throw new Error("GrantAbilityHandler: payload.ability is required and must be a DSL object");
    }
  }

  execute(payload, context, gameState) {
    const { sourceId, targetId, ability } = payload;

    // Register the granted ability via ModifierStack for source tracking
    const mod = gameState.modifierStack.apply({
      sourceId,
      sourceType: payload.sourceType || "equipment",
      targetId,
      type: "ability",
      key: `granted_${ability.type || "custom"}`,
      value: JSON.stringify(ability), // store the full DSL object
      operation: "add",
    });

    // Emit child event so trigger system can pick it up
    context.emitChild("unit:ability:granted", {
      targetId,
      sourceId,
      ability,
      modifierId: mod.id,
    });

    return { modifierId: mod.id, ability };
  }
}
