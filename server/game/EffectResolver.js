/**
 * Recursive DSL resolution engine.
 *
 * Maps compiled DSL objects to handler instances and resolves
 * nested effects (spend_shinsu.effect, grant_ability.ability).
 *
 * Every effect goes through this resolver — handlers never
 * resolve effects directly.
 */

import DealDamageHandler from "./handlers/DealDamageHandler.js";
import HealHandler from "./handlers/HealHandler.js";
import GrantTraitHandler from "./handlers/GrantTraitHandler.js";
import GiveConditionHandler from "./handlers/GiveConditionHandler.js";
import CleanseHandler from "./handlers/CleanseHandler.js";
import CreateLighthouseHandler from "./handlers/CreateLighthouseHandler.js";
import DestroyLighthouseHandler from "./handlers/DestroyLighthouseHandler.js";
import SpendShinsuHandler from "./handlers/SpendShinsuHandler.js";
import DrawCardHandler from "./handlers/DrawCardHandler.js";
import ChargeShinsuHandler from "./handlers/ChargeShinsuHandler.js";
import CompressShinsuHandler from "./handlers/CompressShinsuHandler.js";
import ReclaimCardsHandler from "./handlers/ReclaimCardsHandler.js";
import GrantAbilityHandler from "./handlers/GrantAbilityHandler.js";
import HandlerRegistry from "./registries/handlerRegistry.js";

// Singleton handler registry — populated at module load
let _registry = null;

function getRegistry() {
  if (!_registry) {
    _registry = new HandlerRegistry();

    // Phase 1 baseline handlers
    _registry.register("deal_damage", DealDamageHandler);
    _registry.register("heal", HealHandler);
    _registry.register("grant_trait", GrantTraitHandler);
    _registry.register("give_condition", GiveConditionHandler);
    _registry.register("cleanse", CleanseHandler);
    _registry.register("create_lighthouse", CreateLighthouseHandler);
    _registry.register("destroy_lighthouse", DestroyLighthouseHandler);
    _registry.register("spend_shinsu", SpendShinsuHandler);
    _registry.register("draw_card", DrawCardHandler);

    // Phase 2 handlers
    _registry.register("charge_shinsu", ChargeShinsuHandler);
    _registry.register("compress_shinsu", CompressShinsuHandler);
    _registry.register("reclaim_cards", ReclaimCardsHandler);
    _registry.register("grant_ability", GrantAbilityHandler);
  }
  return _registry;
}

// Eager-load for synchronous use
export function initEffectResolver() {
  return getRegistry();
}

/**
 * Resolve a compiled DSL effect object into its handler execution.
 *
 * Supports nested effects:
 *   - spend_shinsu: deducts shinsu, then resolves inner `effect`
 *   - grant_ability: registers inner `ability` on target (does NOT execute)
 *
 * @param {object} effect — compiled DSL effect object
 * @param {object} context — EventBus EventContext (for emitChild/cancel)
 * @param {GameState} gameState
 * @param {object} [extra] — additional payload merged into handler payload
 * @returns {*} Handler's return value
 */
export function resolveEffect(effect, context, gameState, extra = {}) {
  if (!effect || typeof effect !== "object") {
    throw new Error("EffectResolver: effect must be a DSL object");
  }

  const type = effect.type;

  // Skip unresolved custom effects — Phase 4 responsibility
  if (type === "custom") {
    if (gameState.logger) {
      // Log as warning but don't crash
    }
    return { skipped: true, type: "custom", raw: effect.raw };
  }

  const registry = getRegistry();
  if (!registry.has(type)) {
    throw new Error(
      `EffectResolver: no handler registered for type "${type}". ` +
      `Raw: "${effect.raw}"`
    );
  }

  const handler = registry.get(type);

  // Build payload from DSL + extra context
  const payload = { ...effect, ...extra };

  // Validate before execute
  handler.validate(payload, context);

  // Execute
  const result = handler.execute(payload, context, gameState);

  // Recursively resolve nested effects
  if (effect.effect) {
    // spend_shinsu wraps an inner effect — resolve it after shinsu deduction
    resolveEffect(effect.effect, context, gameState, extra);
  }

  if (effect.ability) {
    // grant_ability wraps an ability — the handler registers it,
    // not resolved recursively here
  }

  return result;
}

/**
 * Resolve multiple effects in sequence.
 */
export function resolveEffects(effects, context, gameState, extra = {}) {
  if (!Array.isArray(effects)) return [];
  return effects.map((effect) => resolveEffect(effect, context, gameState, extra));
}

export default { initEffectResolver, resolveEffect, resolveEffects };
