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
import CreateIncinerateHandler from "./handlers/CreateIncinerateHandler.js";
import HandlerRegistry from "./registries/handlerRegistry.js";
import TargetResolver from "./TargetResolver.js";
import EVT from "./EventCatalog.js";

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
    _registry.register("create_incinerate", CreateIncinerateHandler);
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

  // Preserve unsupported card text but surface it clearly in the game log.
  // This keeps compilation forward-compatible without silently claiming that
  // an authored mechanic resolved.
  if (type === "custom") {
    const result = { skipped: true, reason: "unsupported_effect", type: "custom", raw: effect.raw };
    gameState.eventBus.emit(EVT.EFFECT_UNSUPPORTED, {
      ...result,
      owner: extra.owner || extra.sourceOwner || null,
      sourceId: extra.sourceId || null,
    });
    return result;
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

  // Single-target and non-choice descriptors — resolve immediately through
  // TargetResolver so handlers only ever receive a pre-resolved targetId.
  // This ensures taunt, frontline blocking, ghost, sharpshooter, blinded,
  // and condition filters are always applied consistently.
  const immediateTargets = new Set(["self", "ally", "enemy", "enemies", "bearer", "enemy_frontline", "enemy_backline", "unit"]);
  if (!payload.targetId && immediateTargets.has(payload.target)) {
    // The `condition` DSL field is an overloaded term:
    //   - deal_damage: filter targets to those with this condition
    //   - give_condition: the condition being applied (NOT a filter)
    // Only pass it as a target filter when the effect type uses it that way.
    const conditionIsFilter = !["give_condition", "grant_trait", "cleanse", "heal"].includes(type);
    const targetCondition = conditionIsFilter ? payload.condition : undefined;

    const candidates = TargetResolver.resolveTargets(gameState, {
      target: payload.target,
      sourceUnit: payload.sourceUnit || gameState._findUnit(payload.sourceId),
      sourceOwner: payload.sourceOwner || payload.owner,
      condition: targetCondition,
      conditionValue: payload.conditionValue,
      trait: payload.trait,
      rank: payload.rank,
      position: payload.position,
      count: Number.MAX_SAFE_INTEGER,
    });
    if (candidates.length > 1) {
      const maxChoices = payload.count && payload.count > 1 ? Math.min(payload.count, candidates.length) : 1;
      gameState.createPendingDecision({
        owner: payload.owner || payload.sourceOwner,
        type: "target_selection",
        candidates: candidates.map((unit) => ({ id: unit.id, name: unit.card.name, hp: unit.currentHp })),
        minChoices: maxChoices,
        maxChoices,
        resolve: (targetIds) => {
          TargetResolver.validateTauntSelection(
            candidates,
            targetIds,
            gameState,
            payload.sourceUnit || gameState._findUnit(payload.sourceId)
          );
          targetIds.forEach((targetId) => resolveEffect(effect, context, gameState, { ...extra, targetId }));
        },
      });
      return { pending: true };
    }
    if (candidates.length === 1) payload.targetId = candidates[0].id;
  }

  // If a target descriptor was given but no valid targets were found,
  // the effect was targeting something that doesn't exist — it's a legal
  // no-op, not an error. Handlers only run when a concrete target exists.
  if (!payload.targetId && immediateTargets.has(payload.target)) {
    return { skipped: true, reason: "no valid targets" };
  }

  // Mass-target effects are resolved once for each target, preserving normal
  // handler semantics and making future handlers independent of target count.
  if (!payload.targetId && ["all_allies", "all_enemies"].includes(payload.target)) {
    const conditionIsFilter = !["give_condition", "grant_trait", "cleanse", "heal"].includes(type);
    const targets = TargetResolver.resolveTargets(gameState, {
      target: payload.target,
      sourceUnit: payload.sourceUnit || gameState._findUnit(payload.sourceId),
      sourceOwner: payload.sourceOwner || payload.owner,
      condition: conditionIsFilter ? payload.condition : undefined,
      conditionValue: payload.conditionValue,
      trait: payload.trait,
      rank: payload.rank,
      position: payload.position,
      count: Number.MAX_SAFE_INTEGER,
    });
    return targets.map((target) => resolveEffect(effect, context, gameState, { ...extra, targetId: target.id }));
  }

  // Validate before execute
  handler.validate(payload, context);

  // Execute
  const result = handler.execute(payload, context, gameState);

  // Recursively resolve nested effects. Propagate a pending child so callers
  // suspend their own follow-up work until the child choice is complete.
  if (effect.effect) {
    const nestedResult = resolveEffect(effect.effect, context, gameState, extra);
    if (nestedResult?.pending) return nestedResult;
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

  const results = [];
  for (let index = 0; index < effects.length; index++) {
    const result = resolveEffect(effects[index], context, gameState, extra);
    results.push(result);
    if (result?.pending) {
      // A card's effects resolve in order. Defer every remaining effect until
      // the current target choice is resolved rather than mutating ahead of it.
      gameState.appendPendingDecisionContinuation(() => {
        resolveEffects(effects.slice(index + 1), context, gameState, extra);
      });
      break;
    }
  }
  return results;
}

export default { initEffectResolver, resolveEffect, resolveEffects };
