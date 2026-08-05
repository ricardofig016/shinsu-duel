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

// Who owns a unit relative to the source unit's owner
function isAlly(unit, sourceOwner) {
  return unit.owner === sourceOwner;
}

// ─── Valid line targets ─────────────────────────────────────────────────────
// RULES.md §Lines rule 4: can only target backline if enemy frontline is empty.
// Ghost units don't block backline access. Sharpshooter bypasses entirely.

function getValidEnemyTargets(gameState, sourceUnit) {
  const opponent = gameState.usernames.find((u) => u !== sourceUnit.owner);
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

// ─── Taunt enforcement ──────────────────────────────────────────────────────
// If any enemy has Taunt and is alive, you MUST target them.
// Sharpshooter bypasses this.

function applyTauntFilter(targets, gameState, sourceUnit) {
  const hasSharpshooter = sourceUnit
    ? gameState.modifierStack.has(sourceUnit.id, "trait", "sharpshooter")
    : false;
  if (hasSharpshooter) return targets;

  const taunters = targets.filter((u) =>
    gameState.modifierStack.has(u.id, "trait", "taunt")
  );

  if (taunters.length > 0) return taunters;
  return targets;
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

function filterByRank(targets, rank) {
  if (!rank) return targets;
  return targets.filter((u) => u.card?.rank === rank);
}

function filterByPosition(targets, position) {
  if (!position) return targets;
  return targets.filter((u) => u.placedPositionCode === position);
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
 * @param {string} [options.rank] — filter: only units of this rank
 * @param {string} [options.position] — filter: only units at this position
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
    rank = null,
    position = null,
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
      if (!sourceUnit) throw new Error("TargetResolver: 'ally' requires sourceUnit");
      const allyField = gameState.playerStates[sourceUnit.owner]?.field;
      if (!allyField) return [];
      candidates = [...(allyField.frontline || []), ...(allyField.backline || [])]
        .filter((u) => u.isAlive() && u.id !== sourceUnit.id);
      break;
    }

    case "enemy":
      candidates = getValidEnemyTargets(gameState, sourceUnit);
      candidates = applyTauntFilter(candidates, gameState, sourceUnit);
      break;

    case "enemy_frontline": {
      const opponent = gameState.usernames.find((u) => u !== sourceUnit?.owner);
      candidates = gameState.playerStates[opponent]?.field?.frontline
        ?.filter((u) => u.isAlive()) ?? [];
      break;
    }

    case "enemy_backline": {
      const opponent = gameState.usernames.find((u) => u !== sourceUnit?.owner);
      candidates = gameState.playerStates[opponent]?.field?.backline
        ?.filter((u) => u.isAlive()) ?? [];
      break;
    }

    case "all_allies": {
      if (!sourceUnit) throw new Error("TargetResolver: 'all_allies' requires sourceUnit");
      const allyField = gameState.playerStates[sourceUnit.owner]?.field;
      candidates = allyField
        ? [...(allyField.frontline || []), ...(allyField.backline || [])].filter((u) => u.isAlive())
        : [];
      break;
    }

    case "all_enemies":
      candidates = getValidEnemyTargets(gameState, sourceUnit);
      // Taunt doesn't filter "all enemies" — it forces single-target, not mass
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
  candidates = filterByCondition(candidates, gameState, condition, conditionValue);
  candidates = filterByTrait(candidates, gameState, trait);
  candidates = filterByRank(candidates, rank);
  candidates = filterByPosition(candidates, position);

  // Limit count if specified
  if (count && count < candidates.length) {
    candidates = candidates.slice(0, count);
  }

  if (candidates.length === 0 && target !== "self") {
    // Return empty — caller decides if that's an error or a no-op
  }

  return candidates;
}

export default { resolveTargets };
