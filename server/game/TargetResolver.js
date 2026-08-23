/**
 * Canonical target resolver for all card effects.
 *
 * Resolves human-readable target descriptors into validated unit/lighthouse
 * lists, enforcing RULES.md targeting rules (frontline blocks backline,
 * taunt forces targeting, sharpshooter bypasses, ghost doesn't block).
 *
 * Target descriptors:
 *   "self"           — the source unit itself
 *   "ally"           — one allied unit (choice/resolution by caller)
 *   "enemy"          — one enemy unit (frontline-first unless sharpshooter)
 *   "bearer"         — the unit this equipment is attached to
 *   "all_allies"     — all allied units (filterable by position/condition)
 *   "all_enemies"    — all enemy units (frontline-first)
 *   "enemy_frontline" — enemy frontline units only
 *   "enemy_backline"  — enemy backline units only
 *
 * Optional filters:
 *   { condition: "rooted" }          — only units with this condition
 *   { condition: "burned", conditionValue: 2 } — only units with burned >=2
 *   { trait: "taunt" }               — only units with this trait
 *   { rank: "ranker" }               — only units of this rank
 *   { position: "fisherman" }         — only units in this position
 */

import GameState from "./GameState.js";
import shuffle from "./utils/shuffle.js";

// Who owns a unit relative to the source unit's owner
function isAlly(unit, sourceOwner) {
  return unit.owner === sourceOwner;
}

// ─── Valid line targets ─────────────────────────────────────────────────────
// RULES.md §Lines rule 4: can only target backline if enemy frontline is empty.
// Ghost units don't block backline access. Sharpshooter bypasses entirely.

function getValidEnemyTargets(gameState, sourceUnit, sourceOwner = null) {
  const owner = sourceUnit?.owner || sourceOwner;
  if (!owner) throw new Error("TargetResolver: enemy targeting requires sourceUnit or sourceOwner");
  const opponent = gameState.usernames.find((u) => u !== owner);
  const enemyField = gameState.playerStates[opponent]?.field;
  if (!enemyField) return [];

  const frontline = enemyField.frontline || [];
  const backline = enemyField.backline || [];

  const hasGhost = (unit) => {
    return gameState.modifierStack.has(unit.id, "condition", "ghost");
  };

  // Non-ghost frontline units count as "blockers"
  const blockers = frontline.filter((u) => !hasGhost(u) && u.isAlive());
  const hasBlockers = blockers.length > 0;

  const hasSharpshooter = sourceUnit
    ? gameState.modifierStack.has(sourceUnit.id, "trait", "sharpshooter")
    : false;

  if (hasSharpshooter) {
    // Can target any enemy regardless of line
    return [...frontline, ...backline].filter((u) => u.isAlive());
  }

  if (hasBlockers) {
    return frontline.filter((u) => u.isAlive());
  }

  // Frontline empty → can target backline
  return [...frontline, ...backline].filter((u) => u.isAlive());
}

export function canTargetEnemyLighthouses(gameState, sourceUnit) {
  const opponent = gameState.usernames.find((u) => u !== sourceUnit?.owner);
  const field = gameState.playerStates[opponent]?.field;
  if (!field) return false;
  const isGhost = (unit) => gameState.modifierStack.has(unit.id, "condition", "ghost");
  return [...(field.frontline || []), ...(field.backline || [])]
    .every((unit) => !unit.isAlive() || isGhost(unit));
}

// ─── Taunt enforcement ──────────────────────────────────────────────────────
// Taunt constrains effects from enemy units only. A targetable skill has no
// source unit and therefore does not trigger Taunt.

function getTargetableTaunters(targets, gameState, sourceUnit) {
  if (!sourceUnit) return [];
  return targets.filter((unit) =>
    unit.owner !== sourceUnit.owner && gameState.modifierStack.has(unit.id, "trait", "taunt")
  );
}

function applyTauntFilter(targets, gameState, sourceUnit) {
  if (sourceUnit && gameState.modifierStack.getTargetingRules(sourceUnit).ignoreTaunt) {
    return targets;
  }
  const taunters = getTargetableTaunters(targets, gameState, sourceUnit);
  return taunters.length > 0 ? taunters : targets;
}

/**
 * Remove units that cannot be targeted by `sourceUnit` via a `modify_targeting`
 * `untargetable_by` rule (e.g. "units with Burned 3+ can't target me").
 */
function filterUntargetable(candidates, gameState, sourceUnit) {
  if (!sourceUnit) return candidates;
  return candidates.filter((unit) => {
    const rules = gameState.modifierStack.getTargetingRules(unit);
    if (!rules.untargetableBy) return true;
    return !gameState.modifierStack.matchesUnitFilter(sourceUnit, rules.untargetableBy);
  });
}

/**
 * Validates a player-selected multi-target set against Taunt.
 * Every targetable enemy Taunt unit must be selected before any other enemy
 * may be selected. Skill effects do not have a source unit and bypass Taunt.
 */
export function validateTauntSelection(candidates, selectedIds, gameState, sourceUnit) {
  if (!sourceUnit) return true;
  const selected = new Set(selectedIds);
  const taunters = getTargetableTaunters(candidates, gameState, sourceUnit);
  const missingTaunter = taunters.some((unit) => !selected.has(unit.id));
  if (!missingTaunter) return true;

  const selectedOtherEnemy = candidates.some((unit) =>
    selected.has(unit.id) && unit.owner !== sourceUnit.owner && !taunters.includes(unit)
  );
  if (selectedOtherEnemy) {
    throw new Error("All targetable Taunt units must be selected before other enemy units.");
  }
  return true;
}

// ─── Filter helpers ─────────────────────────────────────────────────────────

function filterByCondition(targets, gameState, condition, conditionValue) {
  if (!condition) return targets;
  return targets.filter((u) => {
    const value = gameState.modifierStack.getEffective(u.id, "condition", condition);
    if (conditionValue !== undefined) return value >= conditionValue;
    return value > 0;
  });
}

function filterByTrait(targets, gameState, trait) {
  if (!trait) return targets;
  return targets.filter((u) =>
    gameState.modifierStack.has(u.id, "trait", trait)
  );
}

function filterByTraitNot(targets, gameState, traitNot) {
  if (!traitNot) return targets;
  return targets.filter((u) =>
    !gameState.modifierStack.has(u.id, "trait", traitNot)
  );
}

// Unit cost is either an exact filter (integer) or a min/max selection
// ("cheapest"/"most expensive"). Units without a numeric cost never match.
function filterByCost(targets, cost) {
  if (cost === undefined) return targets;
  const withCost = targets.filter((u) => typeof u.card?.cost === "number");
  if (typeof cost === "number") {
    return withCost.filter((u) => u.card.cost === cost);
  }
  if (cost === "cheapest" || cost === "most expensive") {
    if (withCost.length === 0) return [];
    const value = cost === "cheapest"
      ? Math.min(...withCost.map((u) => u.card.cost))
      : Math.max(...withCost.map((u) => u.card.cost));
    return withCost.filter((u) => u.card.cost === value);
  }
  return targets;
}

// Keep only the unit(s) at the minimum current HP (stable field order on ties).
function selectLowestHp(targets, lowestHp) {
  if (!lowestHp || targets.length === 0) return targets;
  const min = Math.min(...targets.map((u) => u.currentHp));
  return targets.filter((u) => u.currentHp === min);
}

// Keep only units that have at least one passive ability.
function filterByHasPassive(targets, hasPassive) {
  if (!hasPassive) return targets;
  return targets.filter((u) => (u.card?.passiveAbilities || []).length > 0);
}

// Keep only units that can legally switch position: at least one printed
// position other than the current one whose destination line is not full.
function filterByCanSwitch(targets, gameState, canSwitch) {
  if (!canSwitch) return targets;
  return targets.filter((unit) => {
    const positions = Object.keys(unit.card?.positions || {});
    for (const pos of positions) {
      if (pos === unit.placedPositionCode) continue;
      const line = gameState.constructor.positions[pos]?.line;
      if (line && gameState.playerStates[unit.owner]?.field?.[line]?.length < 5) {
        return true;
      }
    }
    return false;
  });
}

function filterByRank(targets, rank) {
  if (!rank) return targets;
  const ranks = Array.isArray(rank) ? rank : [rank];
  return targets.filter((u) => ranks.includes(u.card?.rank));
}

function filterByPosition(targets, position) {
  if (!position) return targets;
  const positions = Array.isArray(position) ? position : [position];
  return targets.filter((u) => positions.includes(u.placedPositionCode));
}

function filterByAffiliation(targets, affiliation) {
  if (!affiliation) return targets;
  const codes = Array.isArray(affiliation) ? affiliation : [affiliation];
  return targets.filter((u) => codes.some((code) => u.card?.affiliations?.[code] !== undefined));
}

function filterBySharedAffiliation(targets, gameState, sourceUnit) {
  if (!sourceUnit) {
    throw new Error("TargetResolver: shared_affiliation filter requires sourceUnit");
  }
  const sourceAffiliations = new Set([
    ...Object.keys(sourceUnit.card?.affiliations || {}),
    ...gameState.modifierStack.getActiveKeys(sourceUnit.id, "affiliation"),
  ]);
  if (sourceAffiliations.size === 0) return [];
  return targets.filter((u) => {
    const unitAffiliations = new Set([
      ...Object.keys(u.card?.affiliations || {}),
      ...gameState.modifierStack.getActiveKeys(u.id, "affiliation"),
    ]);
    return [...sourceAffiliations].some((code) => unitAffiliations.has(code));
  });
}

function filterByAttribute(targets, attribute) {
  if (!attribute) return targets;
  const codes = Array.isArray(attribute) ? attribute : [attribute];
  return targets.filter((u) => codes.some((code) => u.card?.attributes?.includes(code)));
}

function filterByName(targets, name) {
  if (!name) return targets;
  const expected = String(name).toLowerCase();
  return targets.filter((u) => u.card?.name?.toLowerCase() === expected);
}

function filterByKind(targets, kind) {
  if (!kind) return targets;
  const kinds = Array.isArray(kind) ? kind : [kind];
  return targets.filter((u) => kinds.includes(u.card?.kind));
}

function filterByLine(targets, line) {
  if (!line) return targets;
  const lines = Array.isArray(line) ? line : [line];
  return targets.filter((u) => lines.includes(u.line));
}

/**
 * Apply every unit filter to a candidate list. Shared by `resolveTargets` and
 * `resolveExistenceUnits` so the filter vocabulary has a single source of truth.
 */
function applyFilters(candidates, gameState, filters = {}, sourceUnit = null) {
  const {
    condition = null,
    conditionValue = undefined,
    trait = null,
    traitNot = null,
    cost = undefined,
    rank = null,
    position = null,
    affiliation = null,
    attribute = null,
    name = null,
    kind = null,
    line = null,
    sharedAffiliation = null,
    lowestHp = false,
    hasPassive = false,
    canSwitch = false,
  } = filters;
  candidates = filterByCondition(candidates, gameState, condition, conditionValue);
  candidates = filterByTrait(candidates, gameState, trait);
  candidates = filterByTraitNot(candidates, gameState, traitNot);
  candidates = filterByRank(candidates, rank);
  candidates = filterByPosition(candidates, position);
  candidates = filterByAffiliation(candidates, affiliation);
  candidates = filterByAttribute(candidates, attribute);
  candidates = filterByName(candidates, name);
  candidates = filterByKind(candidates, kind);
  candidates = filterByLine(candidates, line);
  candidates = filterByCost(candidates, cost);
  if (sharedAffiliation) candidates = filterBySharedAffiliation(candidates, gameState, sourceUnit);
  candidates = selectLowestHp(candidates, lowestHp);
  candidates = filterByHasPassive(candidates, hasPassive);
  candidates = filterByCanSwitch(candidates, gameState, canSwitch);
  return candidates;
}

// ─── Structured target translation ──────────────────────────────────────────

/**
 * Translate a structured unit-target descriptor into the canonical string
 * target plus filter fields. Structured descriptors are authored in YAML as
 * `{ side, scope, count, ...filters }`; the resolver speaks a flat string
 * target (`self`, `enemy`, `all_enemies`, …) with filter options.
 *
 * @param {object} descriptor — { side, scope?, count?, condition?, … }
 * @returns {{ target: string, count?: number, [filter: string]: any }}
 */
export function normalizeStructuredTarget(descriptor) {
  if (descriptor === null || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error("TargetResolver: structured target must be an object");
  }

  const { side, scope, random, cost, choose, lowest_hp, has_passive, can_switch, ...filters } = descriptor;

  let target;
  switch (side) {
    case "self":
      target = "self";
      break;
    case "bearer":
      target = "bearer";
      break;
    case "ally":
      target = scope === "all" ? "all_allies" : "ally";
      break;
    case "enemy":
      if (scope === "all") target = "all_enemies";
      else if (scope === "frontline") target = "enemy_frontline";
      else if (scope === "backline") target = "enemy_backline";
      else target = "enemy";
      break;
    case "any":
      target = "unit";
      break;
    default:
      throw new Error(`TargetResolver: unknown structured target side "${side}"`);
  }

  return {
    target,
    ...filters,
    ...(random !== undefined ? { random } : {}),
    ...(cost !== undefined ? { cost } : {}),
    ...(choose !== undefined ? { choose } : {}),
    ...(lowest_hp !== undefined ? { lowestHp: lowest_hp } : {}),
    ...(has_passive !== undefined ? { hasPassive: has_passive } : {}),
    ...(can_switch !== undefined ? { canSwitch: can_switch } : {}),
  };
}

// ─── Main resolver ──────────────────────────────────────────────────────────

/**
 * Resolve a target descriptor into an array of unit references.
 *
 * @param {GameState} gameState
 * @param {object} options
 * @param {string} options.target — target descriptor
 * @param {Unit}   [options.sourceUnit] — the unit originating the effect
 * @param {string} [options.condition] — filter: only units with this condition
 * @param {number} [options.conditionValue] — filter: condition value threshold
 * @param {string} [options.trait] — filter: only units with this trait
 * @param {string|string[]} [options.rank] — filter: only units of this rank (array = OR)
 * @param {string|string[]} [options.position] — filter: only units at this position (array = OR)
 * @param {string|string[]} [options.affiliation] — filter: only units with this affiliation (array = OR)
 * @param {string|string[]} [options.attribute] — filter: only units with this attribute (array = OR)
 * @param {string} [options.name] — filter: only units with this exact card name
 * @param {number} [options.count] — max number of targets (for "2 enemies")
 * @returns {Array<Unit>} Validated, filtered target list
 */
export function resolveTargets(gameState, options) {
  const {
    target,
    sourceUnit = null,
    condition = null,
    conditionValue = undefined,
    trait = null,
    traitNot = null,
    cost = undefined,
    rank = null,
    position = null,
    affiliation = null,
    attribute = null,
    name = null,
    kind = null,
    line = null,
    sharedAffiliation = null,
    lowestHp = false,
    hasPassive = false,
    canSwitch = false,
    count = 1,
  } = options;

  if (!target) throw new Error("TargetResolver: target descriptor is required");

  let candidates = [];

  switch (target) {
    case "self":
      if (!sourceUnit) throw new Error("TargetResolver: 'self' requires sourceUnit");
      candidates = sourceUnit.isAlive() ? [sourceUnit] : [];
      break;

    case "ally": {
      const sourceOwner = sourceUnit?.owner || options.sourceOwner;
      if (!sourceOwner) throw new Error("TargetResolver: 'ally' requires sourceUnit or sourceOwner");
      const allyField = gameState.playerStates[sourceOwner]?.field;
      if (!allyField) return [];
      candidates = [...(allyField.frontline || []), ...(allyField.backline || [])]
        .filter((u) => u.isAlive() && (!sourceUnit || u.id !== sourceUnit.id));
      break;
    }

    case "enemy":
      candidates = getValidEnemyTargets(gameState, sourceUnit, options.sourceOwner);
      candidates = applyTauntFilter(candidates, gameState, sourceUnit);
      break;

    case "enemies":
      // Multi-target choices retain all candidates; validation requires every
      // targetable Taunt unit before other enemies can be selected.
      candidates = getValidEnemyTargets(gameState, sourceUnit, options.sourceOwner);
      break;

    case "enemy_frontline": {
      const owner = sourceUnit?.owner || options.sourceOwner;
      const opponent = gameState.usernames.find((u) => u !== owner);
      candidates = gameState.playerStates[opponent]?.field?.frontline
        ?.filter((u) => u.isAlive()) ?? [];
      break;
    }

    case "enemy_backline": {
      const owner = sourceUnit?.owner || options.sourceOwner;
      const opponent = gameState.usernames.find((u) => u !== owner);
      candidates = gameState.playerStates[opponent]?.field?.backline
        ?.filter((u) => u.isAlive()) ?? [];
      break;
    }

    case "all_allies": {
      const sourceOwner = sourceUnit?.owner || options.sourceOwner;
      if (!sourceOwner) throw new Error("TargetResolver: 'all_allies' requires sourceUnit or sourceOwner");
      const allyField = gameState.playerStates[sourceOwner]?.field;
      candidates = allyField
        ? [...(allyField.frontline || []), ...(allyField.backline || [])].filter((u) => u.isAlive())
        : [];
      break;
    }

    case "all_enemies":
      candidates = getValidEnemyTargets(gameState, sourceUnit, options.sourceOwner);
      // Taunt doesn't filter "all enemies" — it forces single-target, not mass
      break;

    case "enemy_lighthouses":
      if (!canTargetEnemyLighthouses(gameState, sourceUnit)) return [];
      candidates = [{
        id: `lighthouse:${gameState.usernames.find((u) => u !== sourceUnit?.owner)}`,
        type: "lighthouse",
      }];
      break;

    case "bearer":
      // "bearer" is resolved by the caller (equipment context), not here
      if (!sourceUnit) throw new Error("TargetResolver: 'bearer' requires sourceUnit");
      candidates = [sourceUnit];
      break;

    case "unit":
      // Generic: any unit on the board
      for (const username of gameState.usernames) {
        const field = gameState.playerStates[username]?.field;
        if (!field) continue;
        candidates.push(
          ...(field.frontline || []).filter((u) => u.isAlive()),
          ...(field.backline || []).filter((u) => u.isAlive())
        );
      }
      break;

    default:
      throw new Error(`TargetResolver: unknown target descriptor "${target}"`);
  }

  // Apply filters
  candidates = applyFilters(candidates, gameState, {
    condition,
    conditionValue,
    trait,
    traitNot,
    cost,
    rank,
    position,
    affiliation,
    attribute,
    name,
    kind,
    line,
    sharedAffiliation,
    lowestHp,
    hasPassive,
    canSwitch,
  }, sourceUnit);

  // `untargetable_by` targeting rules (source unit cannot target protected units).
  candidates = filterUntargetable(candidates, gameState, sourceUnit);

  // Blinded: randomize choice-descriptor targets (RULES.md).
  // Self, bearer, all_enemies/all_allies, and enemy_lighthouses are not randomized.
  const choiceDescriptors = new Set(["enemy", "ally", "enemies", "unit", "enemy_frontline", "enemy_backline"]);
  if (sourceUnit && gameState.modifierStack.has(sourceUnit.id, "condition", "blinded") && choiceDescriptors.has(target) && candidates.length > 1) {
    shuffle(candidates, gameState._rng);
  }

  // Limit count if specified
  if (count && count < candidates.length) {
    candidates = candidates.slice(0, count);
  }

  if (candidates.length === 0 && target !== "self") {
    // Return empty — caller decides if that's an error or a no-op
  }

  return candidates;
}

/**
 * Filter a list of card-target views against a structured card descriptor.
 *
 * The compiled `card` target (`{ name, series, type, cost, rank, position,
 * affiliation, attribute, choose, random }`) is the sole card-target
 * representation. `cards` is an array of `toCardTargetView()` results (see
 * `utils/cardData.js`); the caller maps its zone source (hand/deck/discard/
 * catalog) through that helper first, so this resolver never cares which zone
 * the cards came from.
 *
 * Filtering only: `choose`/`random` selection is the caller's responsibility
 * (EffectResolver), keeping this function a pure predicate over card views.
 * `cost` accepts an exact integer or `"cheapest"` / `"most expensive"`.
 * `name` is an exact name match; `series` is an exact series-code match.
 *
 * @param {Array<object>} cards — `toCardTargetView` results
 * @param {object} descriptor — compiled structured card target
 * @returns {Array<object>} matching card views, in input order
 */
export function resolveCardTargets(cards, descriptor) {
  if (!Array.isArray(cards) || !descriptor || typeof descriptor !== "object") return [];

  const { name, series, type, cost, rank, position, affiliation, attribute, kind, line } = descriptor;

  const matchAny = (values, test) => {
    const list = Array.isArray(values) ? values : [values];
    return list.some(test);
  };

  let candidates = cards.filter((c) => c && c.name !== undefined);

  if (name) {
    const expected = String(name).toLowerCase();
    candidates = candidates.filter((c) => c.name.toLowerCase() === expected);
  }
  if (series) {
    const expected = String(series).toLowerCase();
    candidates = candidates.filter((c) => c.series?.toLowerCase() === expected);
  }
  if (type) {
    candidates = candidates.filter((c) => c.type === type);
  }
  if (rank !== undefined) {
    candidates = candidates.filter((c) => matchAny(rank, (r) => c.rank === r));
  }
  if (position !== undefined) {
    candidates = candidates.filter((c) => matchAny(position, (p) => c.positions.includes(p)));
  }
  if (affiliation !== undefined) {
    candidates = candidates.filter((c) => matchAny(affiliation, (a) => c.affiliations.includes(a)));
  }
  if (attribute !== undefined) {
    candidates = candidates.filter((c) => matchAny(attribute, (a) => c.attributes.includes(a)));
  }
  if (kind !== undefined) {
    candidates = candidates.filter((c) => matchAny(kind, (k) => c.kind === k));
  }
  if (line !== undefined) {
    candidates = candidates.filter((c) => matchAny(line, (l) => c.line === l));
  }
  if (cost !== undefined) {
    if (typeof cost === "number") {
      candidates = candidates.filter((c) => c.cost === cost);
    } else if (cost === "cheapest" || cost === "most expensive") {
      if (candidates.length > 0) {
        const value = cost === "cheapest"
          ? Math.min(...candidates.map((c) => c.cost))
          : Math.max(...candidates.map((c) => c.cost));
        candidates = candidates.filter((c) => c.cost === value);
      }
    }
  }

  return candidates;
}

/**
 * Resolve every alive unit on a side for an existence predicate, ignoring
 * offensive-targeting rules (frontline blocking, taunt, blinded). Predicates
 * ask "does any matching unit exist?", not "who is a legal target?".
 *
 * @param {GameState} gameState
 * @param {object} descriptor — { side: "ally"|"enemy"|"any", ...filters }
 * @param {string} sourceOwner — owner used to derive the ally/enemy side
 * @returns {Array<Unit>}
 */
export function resolveExistenceUnits(gameState, descriptor, sourceOwner) {
  if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
    throw new Error("TargetResolver: existence descriptor must be an object");
  }

  const { side, ...filters } = descriptor;
  let candidates = [];

  if (side === "any") {
    for (const username of gameState.usernames) {
      const field = gameState.playerStates[username]?.field;
      if (!field) continue;
      candidates.push(
        ...(field.frontline || []).filter((u) => u.isAlive()),
        ...(field.backline || []).filter((u) => u.isAlive())
      );
    }
  } else if (side === "ally" || side === "enemy") {
    if (!sourceOwner) {
      throw new Error(`TargetResolver: existence check for side "${side}" requires sourceOwner`);
    }
    const owner = side === "ally" ? sourceOwner : gameState.usernames.find((u) => u !== sourceOwner);
    const field = gameState.playerStates[owner]?.field;
    if (field) {
      candidates.push(
        ...(field.frontline || []).filter((u) => u.isAlive()),
        ...(field.backline || []).filter((u) => u.isAlive())
      );
    }
  } else {
    throw new Error(`TargetResolver: existence check does not support side "${side}"`);
  }

  return applyFilters(candidates, gameState, filters, null);
}

export default { resolveTargets, resolveCardTargets, resolveExistenceUnits, canTargetEnemyLighthouses, validateTauntSelection, normalizeStructuredTarget };
