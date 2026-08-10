import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Registers a new active ability on a target unit via the AbilityRegistry.
 *
 * DSL type: grant_ability
 * Inner `ability` DSL is NOT executed immediately — it's registered as a
 * usable action on the target unit.
 *
 * Payload:
 *   { sourceId, targetId, ability, sourceType }
 *
 * The ability is tracked by the authoritative AbilityRegistry, which
 * supports source-level cleanup (e.g. unequipping removes the ability).
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
    const { sourceId, targetId, ability, sourceType } = payload;

    // Register the granted ability via the authoritative AbilityRegistry
    const { code } = gameState._abilityRegistry.grant(
      targetId,
      sourceId,
      sourceType || "equipment",
      ability
    );

    // Also track via ModifierStack for source-lifetime cleanup
    // (when the source is removed, the modifier is auto-revoked and
    // LifecycleEngine cleans up the registry entry)
    const mod = gameState.modifierStack.apply({
      sourceId,
      sourceType: payload.sourceType || "equipment",
      targetId,
      type: "ability",
      key: code,
      operation: "add",
    });

    context.emitChild(EVT.UNIT_ABILITY_GRANTED, {
      targetId,
      sourceId,
      ability,
      abilityCode: code,
    });

    return { abilityCode: code, ability };
  }
}
