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
import SlayHandler from "./handlers/SlayHandler.js";
import TransformHandler from "./handlers/TransformHandler.js";
import SummonHandler from "./handlers/SummonHandler.js";
import StealHandler from "./handlers/StealHandler.js";
import DiscardHandler from "./handlers/DiscardHandler.js";
import DisarmHandler from "./handlers/DisarmHandler.js";
import SwitchPositionHandler from "./handlers/SwitchPositionHandler.js";
import RemoveTraitsHandler from "./handlers/RemoveTraitsHandler.js";
import CopyTraitsHandler from "./handlers/CopyTraitsHandler.js";
import GrantRandomTraitHandler from "./handlers/GrantRandomTraitHandler.js";
import PeekHandHandler from "./handlers/PeekHandHandler.js";
import CopyAbilityHandler from "./handlers/CopyAbilityHandler.js";
import RepeatPlayHandler from "./handlers/RepeatPlayHandler.js";
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

    // ── Resource & card economy ───────────────────────────────────────────
    _registry.register("charge_shinsu", ChargeShinsuHandler);
    _registry.register("spend_shinsu", SpendShinsuHandler);
    _registry.register("compress_shinsu", CompressShinsuHandler);
    _registry.register("reclaim_cards", ReclaimCardsHandler);
    _registry.register("create_lighthouse", CreateLighthouseHandler);
    _registry.register("destroy_lighthouse", DestroyLighthouseHandler);
    _registry.register("draw_card", DrawCardHandler);
    _registry.register("create_card", CreateCardHandler);

    // ── Combat & unit state ───────────────────────────────────────────────
    _registry.register("deal_damage", DealDamageHandler);
    _registry.register("heal", HealHandler);
    _registry.register("grant_trait", GrantTraitHandler);
    _registry.register("remove_traits", RemoveTraitsHandler);
    _registry.register("copy_traits", CopyTraitsHandler);
    _registry.register("grant_random_trait", GrantRandomTraitHandler);
    _registry.register("give_condition", GiveConditionHandler);
    _registry.register("remove_conditions", RemoveConditionHandler);

    // ── Zone movement & lifecycle ─────────────────────────────────────────
    _registry.register("summon", SummonHandler);
    _registry.register("steal", StealHandler);
    _registry.register("discard", DiscardHandler);
    _registry.register("disarm", DisarmHandler);
    _registry.register("switch_position", SwitchPositionHandler);
    _registry.register("slay", SlayHandler);
    _registry.register("transform", TransformHandler);

    // ── Abilities ─────────────────────────────────────────────────────────
    _registry.register("grant_ability", GrantAbilityHandler);
    _registry.register("copy_ability", CopyAbilityHandler);
    _registry.register("repeat_play", RepeatPlayHandler);

    // ── Observation ───────────────────────────────────────────────────────
    _registry.register("peek_hand", PeekHandHandler);

    // ── Markers (display-only, no mutation) ───────────────────────────────
    _registry.register("noop", NoopHandler);
    _registry.register("quick", NoopHandler); // skill-level Quick marker
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
  if (effect.targets) {
    return resolveSharedSequence(effect, context, gameState, extra);
  }
  const linksShared = effect.steps.some(
    (step) =>
      step?.target &&
      typeof step.target === "object" &&
      !Array.isArray(step.target) &&
      step.target.link === "sequence"
  );
  if (linksShared) {
    throw new Error(
      "EffectResolver: a step with `target: { link: sequence }` requires the sequence to declare `targets`"
    );
  }
  const results = resolveEffects(effect.steps, context, gameState, extra);
  const pending = results.some((result) => result?.pending);
  return pending ? { resolved: true, pending: true, results } : { resolved: true, results };
}

/**
 * Resolve a `sequence` that declares a shared `targets` descriptor.
 *
 * The shared target set is resolved ONCE (filters, line blocking, taunt,
 * blinded, and the choice/random selection) and every step that references it
 * via `target: { link: sequence }` acts on that same set — optionally a
 * `count: N` subset of it (e.g. "give Burned 1 to one of them").
 *
 * Steps run through a pending-decision continuation rather than inline in the
 * decision's resolve callback, so a nested subset choice is created in
 * continuation context and GameState's `_runContinuations` re-targets the
 * action's completion (end-turn) onto that nested choice.
 */
function resolveSharedSequence(effect, context, gameState, extra) {
  const descriptor = effect.targets;
  const structured = TargetResolver.normalizeStructuredTarget(descriptor);
  const count = structured.count ?? 1;

  const sourceUnit = extra.sourceUnit || gameState._findUnit(extra.sourceId);
  const candidates = TargetResolver.resolveTargets(gameState, {
    target: structured.target,
    sourceUnit,
    sourceOwner: extra.sourceOwner || extra.owner,
    condition: structured.condition,
    conditionValue: structured.conditionValue,
    trait: structured.trait,
    traitNot: structured.traitNot,
    cost: structured.cost,
    rank: structured.rank,
    position: structured.position,
    affiliation: structured.affiliation,
    attribute: structured.attribute,
    name: structured.name,
    sharedAffiliation: structured.shared_affiliation,
    lowestHp: structured.lowestHp,
    hasPassive: structured.hasPassive,
    canSwitch: structured.canSwitch,
    count: Number.MAX_SAFE_INTEGER,
  });

  if (candidates.length === 0) {
    return { resolved: true, skipped: true, reason: "no valid targets" };
  }

  // Random selection: deterministic seeded shuffle, no player decision.
  if (structured.random) {
    shuffle(candidates, gameState._rng);
    return resolveSharedSteps(
      effect.steps, context, gameState, extra,
      candidates.slice(0, count).map((unit) => unit.id)
    );
  }

  // A single candidate needs no decision.
  if (candidates.length === 1) {
    return resolveSharedSteps(effect.steps, context, gameState, extra, candidates.map((unit) => unit.id));
  }

  const take = count && count > 1 ? Math.min(count, candidates.length) : 1;
  let chosenIds = null;
  gameState.createPendingDecision({
    owner: extra.owner || extra.sourceOwner,
    type: "target_selection",
    candidates: candidates.map((unit) => ({ id: unit.id, name: unit.card.name, hp: unit.currentHp })),
    minChoices: take,
    maxChoices: take,
    resolve: (targetIds) => {
      TargetResolver.validateTauntSelection(candidates, targetIds, gameState, sourceUnit);
      chosenIds = targetIds;
    },
  });
  // Queue the step runner as the first continuation (before the action's own
  // completion) so any nested subset decision defers the end-turn correctly.
  gameState.appendPendingDecisionContinuation(() => {
    resolveSharedSteps(effect.steps, context, gameState, extra, chosenIds);
  });
  return { resolved: true, pending: true };
}

/**
 * Resolve the steps of a shared-target sequence against a concrete target set.
 * Link steps resolve once per shared target (or per a chosen `count` subset);
 * non-link steps resolve normally. A pending subset choice defers the
 * remaining steps via a continuation.
 */
function resolveSharedSteps(steps, context, gameState, extra, sharedTargetIds) {
  const results = [];
  for (let index = 0; index < steps.length; index++) {
    const step = steps[index];
    const target = step?.target;
    const isLink =
      target && typeof target === "object" && !Array.isArray(target) && target.link === "sequence";

    if (!isLink) {
      results.push(resolveEffect(step, context, gameState, { ...extra, sharedTargetIds }));
      continue;
    }

    const subset = target.count;
    if (subset === undefined || subset >= sharedTargetIds.length) {
      for (const id of sharedTargetIds) {
        results.push(resolveEffect(step, context, gameState, { ...extra, sharedTargetIds, targetId: id }));
      }
      continue;
    }

    // Subset selection: the player picks `subset` of the already-chosen set.
    gameState.createPendingDecision({
      owner: extra.owner || extra.sourceOwner,
      type: "target_selection",
      candidates: sharedTargetIds.map((id) => {
        const unit = gameState._findUnit(id);
        return { id, name: unit?.card?.name, hp: unit?.currentHp };
      }),
      minChoices: subset,
      maxChoices: subset,
      resolve: (targetIds) => {
        for (const id of targetIds) {
          resolveEffect(step, context, gameState, { ...extra, sharedTargetIds, targetId: id });
        }
      },
    });
    gameState.appendPendingDecisionContinuation(() => {
      resolveSharedSteps(steps.slice(index + 1), context, gameState, extra, sharedTargetIds);
    });
    return { resolved: true, pending: true, results };
  }
  return { resolved: true, results };
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

  // Resolve an authored `owner` role ("you"/"opponent"/"self"/"enemy") into a
  // concrete username. `owner` is a role in the DSL, never a username; the
  // spread above already overwrote it with `extra.owner`, so read the role
  // from the original effect object.
  const OWNER_ROLES = new Set(["you", "opponent", "self", "enemy"]);
  if (typeof effect.owner === "string" && OWNER_ROLES.has(effect.owner)) {
    const acting = extra.owner || extra.sourceOwner;
    payload.owner = effect.owner === "opponent" || effect.owner === "enemy"
      ? gameState.usernames.find((u) => u !== acting)
      : acting;
  }

  // Shared-target link steps are resolved by resolveSharedSequence, which
  // supplies `sharedTargetIds` plus a concrete `targetId`. A link target
  // reached any other way is an authoring/runtime error.
  if (
    payload.target &&
    typeof payload.target === "object" &&
    !Array.isArray(payload.target) &&
    payload.target.link === "sequence"
  ) {
    if (!extra.sharedTargetIds) {
      throw new Error(
        "EffectResolver: a `target: { link: sequence }` step requires an enclosing sequence with `targets`"
      );
    }
    if (!payload.targetId) {
      throw new Error("EffectResolver: a link step must resolve to a concrete targetId");
    }
  }

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
      hasPassive: targetFilters.hasPassive,
      canSwitch: targetFilters.canSwitch,
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

  // Structured `source` unit descriptor (copy_traits / copy_ability): resolve
  // it into a concrete `sourceUnitId`. Handlers never receive a `source`
  // descriptor — there is a single resolution path through TargetResolver.
  const SOURCE_DESCRIPTOR_TYPES = new Set(["copy_traits", "copy_ability"]);
  if (SOURCE_DESCRIPTOR_TYPES.has(type) && !payload.sourceUnitId && payload.source && typeof payload.source === "object" && !Array.isArray(payload.source)) {
    const structured = TargetResolver.normalizeStructuredTarget(payload.source);
    const sourceCandidates = TargetResolver.resolveTargets(gameState, {
      target: structured.target,
      sourceUnit: payload.sourceUnit || gameState._findUnit(payload.sourceId),
      sourceOwner: payload.sourceOwner || payload.owner,
      condition: structured.condition,
      conditionValue: structured.conditionValue,
      trait: structured.trait,
      traitNot: structured.traitNot,
      cost: structured.cost,
      rank: structured.rank,
      position: structured.position,
      affiliation: structured.affiliation,
      attribute: structured.attribute,
      name: structured.name,
      count: Number.MAX_SAFE_INTEGER,
    });

    if (sourceCandidates.length === 0) {
      return { skipped: true, reason: "no valid source" };
    }
    if (structured.random) {
      shuffle(sourceCandidates, gameState._rng);
      return resolveEffect(effect, context, gameState, { ...extra, sourceUnitId: sourceCandidates[0].id });
    }
    if (sourceCandidates.length === 1) {
      payload.sourceUnitId = sourceCandidates[0].id;
    } else {
      gameState.createPendingDecision({
        owner: payload.owner || payload.sourceOwner,
        type: "target_selection",
        candidates: sourceCandidates.map((unit) => ({ id: unit.id, name: unit.card.name, hp: unit.currentHp })),
        minChoices: 1,
        maxChoices: 1,
        resolve: ([sourceUnitId]) => {
          resolveEffect(effect, context, gameState, { ...extra, sourceUnitId });
        },
      });
      return { pending: true };
    }
  }

  // `discard` targeting bearer attachments (`zone: attachments`): resolve the
  // matching attached equipment instance ids and hand them to the handler.
  if (type === "discard" && payload.card?.zone === "attachments" && !payload.attachmentIds) {
    const unit = payload.sourceUnit || gameState._findUnit(payload.sourceId);
    const attachments = (unit?.equipmentAttachments || []).map(toCardTargetView).filter(Boolean);
    const matches = TargetResolver.resolveCardTargets(attachments, payload.card);
    payload.attachmentIds = matches.map((c) => c.id);
  }

  // Structured card targets ({ name, type, cost, ... }) select a card from the
  // relevant zone for the card-consuming effects. An explicit `card.zone` wins;
  // otherwise the zone is derived from the effect type. `create_card` resolves
  // its own catalog candidates inside its handler, and `discard` against
  // `zone: attachments` resolves bearer equipment above.
  if (payload.card && typeof payload.card === "object" && !Array.isArray(payload.card) && !payload.targetCardId) {
    const cardTarget = payload.card;
    const owner = payload.owner || payload.sourceOwner || extra.owner;
    const player = owner ? gameState.playerStates[owner] : null;
    // An explicit `card.zone` wins; otherwise the zone is derived from the
    // effect type (compress → hand, draw → deck, reclaim → discard, discard
    // → hand). `attachments` is resolved separately above (bearer equipment).
    const zone = cardTarget.zone ??
      (type === "compress_shinsu" ? "hand"
        : type === "draw_card" ? "deck"
        : type === "reclaim_cards" ? "discard"
        : type === "discard" ? "hand"
        : null);
    const zoneCards = zone && zone !== "attachments" ? player?.[zone] : null;

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
      } else {
        // A structured card target that matches nothing is a legal no-op,
        // mirroring the unit-target path above — handlers never run without a
        // concrete target, so a filtered draw/reclaim/compress does nothing.
        return { skipped: true, reason: "no valid targets" };
      }
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
