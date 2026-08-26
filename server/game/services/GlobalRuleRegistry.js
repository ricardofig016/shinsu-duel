import * as IdFactory from "../IdFactory.js";
import GiveConditionHandler from "../handlers/GiveConditionHandler.js";
import positions from "../../data/positions.json" with { type: "json" };

const RULE_TYPES = new Set([
  "disable_passives",
  "prevent_evolve",
  "prevent_equip",
  "grant_global_trait",
  "grant_global_condition",
  "condition_stack_cap",
]);

const GRANT_TYPES = new Set(["grant_global_trait", "grant_global_condition"]);

/**
 * Registry of landmark `rules` — always-on, board-wide battlefield rules
 * distinct from unit passives (see `PASSIVE_SYSTEM_ARCHITECTURE.md`).
 *
 * Rule entries are `type: "rule"` modifiers sourced from `Landmark#<unitId>`,
 * so revocation is a plain `removeBySource`. `grant_global_trait` /
 * `grant_global_condition` additionally *derive* trait/condition modifiers on
 * every matching unit; those derived modifiers are sourced from the same
 * landmark source id and tagged `meta.landmarkGrant` so they can be rebuilt
 * without touching the rule entries themselves.
 *
 * Irregulars (RULES.md "Unit passives and landmark rules have no effect on
 * me") never match any rule here — that exclusion lives in `matches()`, the
 * single predicate every consumer (`hasRule`, `reconcile`, condition caps)
 * goes through.
 */
export default class GlobalRuleRegistry {
  constructor() {
    this._registered = new Set();
    this._reconciling = false;
  }

  /**
   * Register (or idempotently re-register) a landmark's rules.
   *
   * A `position: "chosen"` rule cannot go live until the landmark's owner has
   * picked a position (`unit.chosenPositionCode`); calling this again after
   * the choice is made re-registers cleanly because rule entries are
   * rebuilt from scratch every time.
   */
  registerUnit(unit, gameState) {
    if (!unit || unit.card?.kind !== "landmark") return;
    const rules = unit.card.rules || [];
    this._validateRules(rules, gameState);

    const sourceId = IdFactory.landmarkSource(unit.id);
    const needsChoice = rules.some((rule) => rule.position === "chosen");
    if (needsChoice && !unit.chosenPositionCode) {
      // Not activatable yet; ensure no stale entries linger from a prior
      // registration attempt (there should never be any, but this keeps the
      // method safe to call repeatedly before the choice resolves).
      gameState.modifierStack.removeWhere((mod) => mod.sourceId === sourceId);
      this._registered.delete(sourceId);
      return;
    }

    // Rebuild rule entries from scratch so re-registration (e.g. after a
    // chosen-position pick) never duplicates or leaves stale entries.
    gameState.modifierStack.removeWhere((mod) => mod.sourceId === sourceId && mod.type === "rule");
    for (const rule of rules) {
      gameState.modifierStack.apply({
        sourceId,
        sourceType: "landmark",
        targetId: unit.id,
        type: "rule",
        key: rule.type,
        value: 1,
        operation: "add",
        meta: { rule },
      });
    }
    this._registered.add(sourceId);
    this.reconcile(gameState);
  }

  /** Revoke every rule and derived grant a landmark unit owns. */
  unregisterUnit(unitId, gameState) {
    const sourceId = IdFactory.landmarkSource(unitId);
    gameState.modifierStack.removeBySource(sourceId);
    this._registered.delete(sourceId);
    this.reconcile(gameState);
  }

  /**
   * Active landmark rule entries, optionally filtered by rule `type`.
   * "Active" means enabled (not silenced) — `getModifiersByType` already
   * excludes nothing by disabledCount, so filter it explicitly here.
   */
  getActiveRules(gameState, type = null) {
    return gameState.modifierStack
      .getModifiersByType("rule")
      .filter((entry) => entry.disabledCount === 0 && (!type || entry.key === type));
  }

  /** Active rule entries of `type` (or every type) whose scope matches `unit`. */
  rulesForUnit(unit, gameState, type = null) {
    return this.getActiveRules(gameState, type).filter((entry) =>
      this.matches(entry.meta?.rule, unit, gameState, gameState._findUnit?.(entry.targetId))
    );
  }

  hasRule(unit, type, gameState) {
    return this.rulesForUnit(unit, gameState, type).length > 0;
  }

  /** Minimum active `condition_stack_cap` affecting `unit` for `condition`, or null. */
  getConditionCap(unit, condition, gameState) {
    const caps = this.rulesForUnit(unit, gameState, "condition_stack_cap").map((entry) => entry.meta.rule.cap);
    return caps.length ? Math.min(...caps) : null;
  }

  /**
   * Whether `rule` (owned by `sourceUnit`, or resolved from `gameState` when
   * omitted) applies to `unit`. Irregulars are excluded from every landmark
   * rule (RULES.md "Unit passives and landmark rules have no effect on me");
   * their traits/conditions/abilities are unaffected by this exclusion.
   */
  matches(rule, unit, gameState, sourceUnit = null) {
    if (!rule || !unit) return false;
    const nativeIrregular = (unit.card?.attributes || []).includes("irregular");
    const grantedIrregular = gameState?.modifierStack?.has(unit.id, "attribute", "irregular");
    if (nativeIrregular || grantedIrregular) return false;
    if (rule.position === undefined) return true;
    if (rule.position === "chosen") {
      const source = sourceUnit;
      return Boolean(source?.chosenPositionCode && unit.placedPositionCode === source.chosenPositionCode);
    }
    return unit.placedPositionCode != null && unit.placedPositionCode === rule.position;
  }

  /**
   * Rebuild every derived `grant_global_trait` / `grant_global_condition`
   * modifier from the currently active rule entries. Idempotent and safe to
   * call after any board change (deploy, transform, move, destroy, round
   * cleanup, or a modifier changing whether a unit matches a rule/cap).
   *
   * Condition grants route through `GiveConditionHandler.applyCondition` so
   * Immune, amplifiers, and caps are honored exactly like any other
   * `give_condition` effect — reconcile never writes condition modifiers
   * directly.
   */
  reconcile(gameState) {
    if (this._reconciling) return;
    this._reconciling = true;
    try {
      const entries = this.getActiveRules(gameState).filter((entry) => GRANT_TYPES.has(entry.key));

      // Drop every previously derived grant before rebuilding. This includes
      // grants from a rule that has since been disabled. The metadata keeps
      // ordinary traits/conditions and grants from non-landmark sources out.
      gameState.modifierStack.removeWhere(
        (mod) => mod.sourceType === "landmark" && mod.meta?.landmarkGrant === true
      );

      for (const entry of entries) {
        const rule = entry.meta.rule;
        const source = gameState._findUnit?.(entry.targetId);
        if (!source) continue;

        for (const unit of this._units(gameState)) {
          if (!this.matches(rule, unit, gameState, source)) continue;

          if (entry.key === "grant_global_trait") {
            gameState.modifierStack.apply({
              sourceId: entry.sourceId,
              sourceType: "landmark",
              targetId: unit.id,
              type: "trait",
              key: rule.trait,
              value: 1,
              operation: "add",
              meta: { landmarkGrant: true, ruleType: entry.key },
            });
          } else {
            // grant_global_condition: a continuous condition grant is exactly
            // one application of the authoritative give_condition path. It
            // is re-applied every reconcile, so it is naturally suppressed
            // while the target is Immune and capped like any other source.
            GiveConditionHandler.applyCondition({
              sourceId: entry.sourceId,
              sourceType: "landmark",
              targetId: unit.id,
              condition: rule.condition,
              amount: 1,
              meta: { landmarkGrant: true, ruleType: entry.key },
            }, gameState);
          }
        }
      }
    } finally {
      this._reconciling = false;
    }
  }

  _validateRules(rules, gameState) {
    for (const rule of rules) {
      if (!rule || typeof rule !== "object" || !RULE_TYPES.has(rule.type)) {
        throw new Error(`Unknown landmark rule type: ${rule?.type}`);
      }
      if (rule.type === "grant_global_trait" && !rule.trait) {
        throw new Error("grant_global_trait requires a trait");
      }
      if (rule.type === "grant_global_condition" && !rule.condition) {
        throw new Error("grant_global_condition requires a condition");
      }
      if (rule.type === "condition_stack_cap" && (!Number.isInteger(rule.cap) || rule.cap < 1)) {
        throw new Error("condition_stack_cap requires a positive integer cap");
      }
      if (
        rule.position !== undefined &&
        rule.position !== "chosen" &&
        !positions[rule.position]
      ) {
        throw new Error(`Invalid landmark rule position: ${rule.position}`);
      }
    }
  }

  _units(gameState) {
    return gameState.usernames.flatMap((name) => {
      const field = gameState.playerStates[name]?.field || {};
      return [...(field.frontline || []), ...(field.backline || [])];
    });
  }
}
