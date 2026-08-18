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
import RemoveConditionHandler from "./handlers/RemoveConditionHandler.js";
import CreateLighthouseHandler from "./handlers/CreateLighthouseHandler.js";
import DestroyLighthouseHandler from "./handlers/DestroyLighthouseHandler.js";
import SpendShinsuHandler from "./handlers/SpendShinsuHandler.js";
import DrawCardHandler from "./handlers/DrawCardHandler.js";
import ChargeShinsuHandler from "./handlers/ChargeShinsuHandler.js";
import CompressShinsuHandler from "./handlers/CompressShinsuHandler.js";
import ReclaimCardsHandler from "./handlers/ReclaimCardsHandler.js";
import GrantAbilityHandler from "./handlers/GrantAbilityHandler.js";
import CreateCardHandler from "./handlers/CreateCardHandler.js";
import NoopHandler from "./handlers/NoopHandler.js";
import HandlerRegistry from "./registries/handlerRegistry.js";
import TargetResolver from "./TargetResolver.js";
import PredicateEvaluator from "./services/PredicateEvaluator.js";
import shuffle from "./utils/shuffle.js";
import { toCardTargetView } from "./utils/cardData.js";
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
    _registry.register("remove_conditions", RemoveConditionHandler);
    _registry.register("create_lighthouse", CreateLighthouseHandler);
    _registry.register("destroy_lighthouse", DestroyLighthouseHandler);
    _registry.register("spend_shinsu", SpendShinsuHandler);
    _registry.register("draw_card", DrawCardHandler);

    // Phase 2 handlers
    _registry.register("charge_shinsu", ChargeShinsuHandler);
    _registry.register("compress_shinsu", CompressShinsuHandler);
    _registry.register("reclaim_cards", ReclaimCardsHandler);
    _registry.register("grant_ability", GrantAbilityHandler);
    _registry.register("create_card", CreateCardHandler);
    _registry.register("noop", NoopHandler);
    _registry.register("quick", NoopHandler); // skill-level Quick marker (display-only)
  }
  return _registry;
}

// Eager-load for synchronous use
export function initEffectResolver() {
  return getRegistry();
}

/**
 * Resolve a `sequence` node: run `steps` in order, deferring remaining steps
 * through the pending-decision continuation so a target choice never runs
 * ahead of later mutations.
 */
function resolveSequence(effect, context, gameState, extra) {
  if (!Array.isArray(effect.steps)) {
    throw new Error("EffectResolver: sequence requires a `steps` array");
  }
  const results = resolveEffects(effect.steps, context, gameState, extra);
  const pending = results.some((result) => result?.pending);
  return pending ? { resolved: true, pending: true, results } : { resolved: true, results };
}

/**
 * Resolve a `conditional` node: evaluate the `if` predicate, then resolve the
 * matching branch (`then` when true, `otherwise` when false). A missing branch
 * is a legal no-op.
 */
function resolveConditional(effect, context, gameState, extra) {
  if (!effect.if) throw new Error("EffectResolver: conditional requires an `if` predicate");
  const branch = PredicateEvaluator.evaluate(effect.if, gameState, extra) ? effect.then : effect.otherwise;
  if (!branch) return { resolved: true };
  return resolveEffect(branch, context, gameState, extra);
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

  // Structural nodes resolve recursively here, not through a handler class.
  // `sequence` runs its `steps` in order; `conditional` picks a branch by
  // evaluating its `if` predicate against the current board/deck state.
  if (type === "sequence") return resolveSequence(effect, context, gameState, extra);
  if (type === "conditional") return resolveConditional(effect, context, gameState, extra);

  const registry = getRegistry();
  if (!registry.has(type)) {
    // Transitional: a valid DSL `type` whose handler is not yet implemented is
    // skipped and surfaced through EFFECT_UNSUPPORTED rather than throwing.
    // Once the full catalog is implemented, this path becomes a hard error.
    const result = { skipped: true, reason: "unsupported_effect", type, raw: effect.raw };
    gameState.eventBus.emit(EVT.EFFECT_UNSUPPORTED, {
      ...result,
      owner: extra.owner || extra.sourceOwner || null,
      sourceId: extra.sourceId || null,
    });
    return result;
  }

  const handler = registry.get(type);

  // Build payload from DSL + extra context
  const payload = { ...effect, ...extra };

  // Structured unit-target descriptors ({ side, scope, count, ... }) are
  // translated into the canonical string target + filter fields. Handlers
  // never receive an object target — there is a single resolution path
  // through TargetResolver.
  let targetFilters = {};
  if (!payload.targetId && payload.target && typeof payload.target === "object" && !Array.isArray(payload.target)) {
    const structured = TargetResolver.normalizeStructuredTarget(payload.target);
    payload.target = structured.target;
    if (structured.count !== undefined) payload.count = structured.count;
    targetFilters = structured;
  }

  // Build the filter options handed to TargetResolver. Structured-target
  // filters take precedence; effect-level filters apply otherwise. Two
  // effect-level fields are overloaded (they name the thing being applied,
  // not a target filter): `condition` for give_condition/grant_trait/remove_conditions/
  // heal, and `trait` for grant_trait. Effect-level `position` is the ability
  // position requirement, never a target filter.
  const buildTargetOptions = () => {
    const conditionIsFilter = !["give_condition", "grant_trait", "remove_conditions", "heal"].includes(type);
    const traitIsFilter = type !== "grant_trait";
    return {
      target: payload.target,
      sourceUnit: payload.sourceUnit || gameState._findUnit(payload.sourceId),
      sourceOwner: payload.sourceOwner || payload.owner,
      condition: targetFilters.condition ?? (conditionIsFilter ? payload.condition : undefined),
      conditionValue: targetFilters.conditionValue ?? payload.conditionValue,
      trait: targetFilters.trait ?? (traitIsFilter ? payload.trait : undefined),
      traitNot: targetFilters.traitNot ?? payload.traitNot,
      cost: targetFilters.cost ?? payload.cost,
      rank: targetFilters.rank,
      position: targetFilters.position,
      affiliation: targetFilters.affiliation,
      attribute: targetFilters.attribute,
      name: targetFilters.name,
      sharedAffiliation: targetFilters.shared_affiliation,
      lowestHp: targetFilters.lowestHp ?? payload.lowestHp,
      count: Number.MAX_SAFE_INTEGER,
    };
  };

  // Single-target and non-choice descriptors — resolve immediately through
  // TargetResolver so handlers only ever receive a pre-resolved targetId.
  // This ensures taunt, frontline blocking, ghost, sharpshooter, blinded,
  // and condition filters are always applied consistently.
  const immediateTargets = new Set(["self", "ally", "enemy", "enemies", "bearer", "enemy_frontline", "enemy_backline", "unit"]);
  if (!payload.targetId && immediateTargets.has(payload.target)) {
    const candidates = TargetResolver.resolveTargets(gameState, buildTargetOptions());

    // Explicit random selection: shuffle with the seeded RNG and auto-pick
    // the requested count — no player decision.
    if (targetFilters.random && candidates.length > 0) {
      shuffle(candidates, gameState._rng);
      const take = payload.count && payload.count > 1 ? Math.min(payload.count, candidates.length) : 1;
      return candidates.slice(0, take).map((unit) =>
        resolveEffect(effect, context, gameState, { ...extra, targetId: unit.id })
      );
    }

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
    const targets = TargetResolver.resolveTargets(gameState, buildTargetOptions());
    return targets.map((target) => resolveEffect(effect, context, gameState, { ...extra, targetId: target.id }));
  }

  // Structured card targets ({ name, type, cost, ... }) select a card from the
  // relevant zone for the card-consuming effects. The zone is derived from the
  // effect type (not `card.zone`, which is not authored today). `create_card`
  // resolves its own catalog candidates inside its handler.
  if (payload.card && typeof payload.card === "object" && !Array.isArray(payload.card) && !payload.targetCardId) {
    const cardTarget = payload.card;
    const owner = payload.owner || payload.sourceOwner || extra.owner;
    const player = owner ? gameState.playerStates[owner] : null;
    let zoneCards = null;
    if (type === "compress_shinsu") zoneCards = player?.hand;
    else if (type === "draw_card") zoneCards = player?.deck;
    else if (type === "reclaim_cards") zoneCards = player?.discard;

    if (zoneCards) {
      const candidates = TargetResolver.resolveCardTargets(
        zoneCards.map((card) => toCardTargetView(card)).filter(Boolean),
        cardTarget
      );

      if (candidates.length > 0) {
        if (cardTarget.random) {
          shuffle(candidates, gameState._rng);
          payload.targetCardId = candidates[0].id;
        } else if (cardTarget.choose && candidates.length > 1) {
          gameState.createPendingDecision({
            owner,
            type: "card_selection",
            candidates: candidates.map((c) => ({ id: c.id, name: c.name, cost: c.cost, type: c.type })),
            minChoices: 1,
            maxChoices: 1,
            resolve: ([targetCardId]) => {
              resolveEffect(effect, context, gameState, { ...extra, targetCardId });
            },
          });
          return { pending: true };
        } else {
          payload.targetCardId = candidates[0].id;
        }
      }
      // No match: handlers validate a required target and throw a descriptive error.
    }
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
