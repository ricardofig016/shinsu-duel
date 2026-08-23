import PredicateEvaluator from "./PredicateEvaluator.js";
import TargetResolver from "../TargetResolver.js";

/**
 * Applies always-on modifier nodes (`modify_*`, `retain_equipment`) as
 * source-tracked ModifierStack entries.
 *
 * A modifier is the runtime form of a trigger-less passive or an equipment
 * `effects` entry that augments some ongoing behavior (damage, heal, cost,
 * condition application, keywords, targeting, ability repetition) instead of
 * resolving a one-shot effect. Every entry is keyed by the caller's `sourceId`
 * so revocation (`modifierStack.removeBySource`) undoes exactly the modifiers
 * that source applied.
 *
 * The `target` field carries three meanings by type:
 *   - attachment target — which units receive the modifier (modify_stat
 *     damage/heal/hp, modify_keyword, modify_repeat, modify_ability);
 *   - victim filter — which ability targets are amplified (modify_condition);
 *   - blocked-actor filter — who cannot target the source (modify_targeting
 *     `untargetable_by`).
 */
const MODIFIER_TYPES = new Set([
  "modify_stat",
  "modify_cost",
  "modify_condition",
  "modify_keyword",
  "modify_targeting",
  "modify_repeat",
  "retain_equipment",
  "modify_ability",
]);

export default class ModifierService {
  /** Whether a compiled node is an always-on modifier (vs an effect). */
  static isModifier(node) {
    return Boolean(node && typeof node === "object" && MODIFIER_TYPES.has(node.type));
  }

  /**
   * Apply one modifier node, returning `{ applied, count }` or a reason.
   *
   * @param {object} node — compiled modifier node
   * @param {GameState} gameState
   * @param {object} extra — { sourceId, sourceType?, sourceUnit?, sourceOwner?, owner? }
   */
  static applyModifier(node, gameState, extra = {}) {
    if (!this.isModifier(node)) return { applied: false, reason: "not-a-modifier" };
    const sourceId = extra.sourceId;
    if (!sourceId) throw new Error("ModifierService: sourceId is required");

    // Predicate gate (`if`) — a modifier whose predicate is false applies
    // nothing; a later re-evaluation revokes/restores it when it flips.
    if (node.if && !PredicateEvaluator.evaluate(node.if, gameState, extra)) {
      return { applied: false, reason: "if-false" };
    }

    // Node-level `position` scopes a modifier to the source unit's current
    // position (e.g. Lo Po Bia Ren "wave controller: ..."). Equipment
    // `effects` modifiers resolve through this same path, so the gate lives
    // here rather than in PassiveManager.
    if (node.position && (!extra.sourceUnit || extra.sourceUnit.placedPositionCode !== node.position)) {
      return { applied: false, reason: "position-mismatch" };
    }

    switch (node.type) {
      case "modify_stat": return this._applyStat(node, gameState, extra);
      case "modify_cost": return this._applyCost(node, gameState, extra);
      case "modify_condition": return this._applyCondition(node, gameState, extra);
      case "modify_keyword": return this._applyKeyword(node, gameState, extra);
      case "modify_targeting": return this._applyTargeting(node, gameState, extra);
      case "modify_repeat": return this._applyRepeat(node, gameState, extra);
      case "retain_equipment": return this._applyRetain(node, gameState, extra);
      case "modify_ability": return this._applyAbility(node, gameState, extra);
      default:
        return { applied: false, reason: "unhandled-modifier", type: node.type };
    }
  }

  /**
   * Revoke every modifier a source applied — the symmetric counterpart to
   * `applyModifier`. All modifier revocation funnels through the stack's
   * `removeBySource` so callers keep a single apply/revoke API.
   */
  static revokeBySource(gameState, sourceId) {
    gameState.modifierStack.removeBySource(sourceId);
  }

  /**
   * Resolve a structured unit target to every matching unit (no choice, no
   * count cap — modifiers apply to all matching units).
   */
  static _resolveUnits(gameState, node, extra) {
    const sourceUnit = extra.sourceUnit || gameState._findUnit(extra.sourceId);
    const structured = TargetResolver.normalizeStructuredTarget(node.target);
    return TargetResolver.resolveTargets(gameState, {
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
      count: Number.MAX_SAFE_INTEGER,
    });
  }

  static _sourceUnit(gameState, extra) {
    return extra.sourceUnit || gameState._findUnit(extra.sourceId);
  }

  static _sourceType(extra) {
    return extra.sourceType || "passive";
  }

  static _applyStat(node, gameState, extra) {
    if (node.stat === "cost") return this._applyCostStat(node, gameState, extra);
    if (node.stat === "hp") return this._applyHp(node, gameState, extra);

    const units = this._resolveUnits(gameState, node, extra);
    let count = 0;
    for (const unit of units) {
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: unit.id,
        type: "stat",
        key: node.stat,
        value: node.amount,
        meta: { when: node.when ?? null, source: node.source ?? null },
      });
      count++;
    }
    return { applied: count > 0, count };
  }

  /** `modify_stat { stat: hp }` raises both current and max HP (and revokes them). */
  static _applyHp(node, gameState, extra) {
    const units = this._resolveUnits(gameState, node, extra);
    const delta = node.amount;
    let count = 0;
    for (const unit of units) {
      unit.card.maxHp += delta;
      unit.currentHp += delta;
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: unit.id,
        type: "stat",
        key: "hp",
        value: delta,
        meta: { hpDelta: delta },
      });
      count++;
    }
    return { applied: count > 0, count };
  }

  /** `modify_stat { stat: cost }` — board-wide cost modifier keyed to the affected player. */
  static _applyCostStat(node, gameState, extra) {
    const sourceOwner = extra.sourceOwner || extra.owner;
    const target = node.target || {};
    const affectedOwner = target.side === "enemy"
      ? gameState.usernames.find((u) => u !== sourceOwner)
      : sourceOwner;

    gameState.modifierStack.apply({
      sourceId: extra.sourceId,
      sourceType: this._sourceType(extra),
      targetId: affectedOwner,
      type: "stat",
      key: "cost",
      value: node.amount,
      meta: {
        cardType: node.cardType ?? null,
        affiliations: target.affiliation
          ? (Array.isArray(target.affiliation) ? target.affiliation : [target.affiliation])
          : [],
      },
    });
    return { applied: true, count: 1 };
  }

  /** `modify_cost { amount, if? }` — a card's own cost reduction (no board target). */
  static _applyCost(node, gameState, extra) {
    // A card's own cost modifier is consulted at play time by
    // ModifierService.getEffectiveCost, not stored on the board. The `if`
    // gate is re-evaluated there against the acting player.
    return { applied: false, reason: "consult-at-play-time" };
  }

  /** `modify_condition { condition, amount, target, if? }` — amplify a condition the source applies. */
  static _applyCondition(node, gameState, extra) {
    const sourceUnit = this._sourceUnit(gameState, extra);
    gameState.modifierStack.apply({
      sourceId: extra.sourceId,
      sourceType: this._sourceType(extra),
      targetId: sourceUnit.id,
      type: "stat",
      key: "condition",
      value: node.amount,
      meta: { condition: node.condition, victimFilter: node.target ?? null },
    });
    return { applied: true, count: 1 };
  }

  /** `modify_keyword { keyword, target, first? }` — grant a keyword to units. */
  static _applyKeyword(node, gameState, extra) {
    const units = this._resolveUnits(gameState, node, extra);
    let count = 0;
    for (const unit of units) {
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: unit.id,
        type: "keyword",
        key: node.keyword,
        value: 1,
        meta: { first: node.first ?? false },
      });
      count++;
    }
    return { applied: count > 0, count };
  }

  /** `modify_targeting { rule, target }` — ignore_taunt / untargetable_by on the source unit. */
  static _applyTargeting(node, gameState, extra) {
    const sourceUnit = this._sourceUnit(gameState, extra);

    if (node.rule === "ignore_taunt") {
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: sourceUnit.id,
        type: "keyword",
        key: "ignore_taunt",
        value: 1,
        meta: { first: false },
      });
      return { applied: true, count: 1 };
    }

    if (node.rule === "untargetable_by") {
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: sourceUnit.id,
        type: "keyword",
        key: "untargetable_by",
        value: 1,
        meta: { blockedFilter: node.target ?? null },
      });
      return { applied: true, count: 1 };
    }

    return { applied: false, reason: "unhandled-targeting-rule", rule: node.rule };
  }

  /** `modify_repeat { amount, target }` — the target's abilities trigger `amount` times. */
  static _applyRepeat(node, gameState, extra) {
    const units = this._resolveUnits(gameState, node, extra);
    let count = 0;
    for (const unit of units) {
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: unit.id,
        type: "stat",
        key: "repeat",
        value: node.amount,
      });
      count++;
    }
    return { applied: count > 0, count };
  }

  /** `retain_equipment` — the source keeps its equipment on return to hand. */
  static _applyRetain(node, gameState, extra) {
    const sourceUnit = this._sourceUnit(gameState, extra);
    gameState.modifierStack.apply({
      sourceId: extra.sourceId,
      sourceType: this._sourceType(extra),
      targetId: sourceUnit.id,
      type: "keyword",
      key: "retain_equipment",
      value: 1,
      meta: { first: false },
    });
    return { applied: true, count: 1 };
  }

  /** `modify_ability { target, effect, position?, if? }` — augment units' abilities. */
  static _applyAbility(node, gameState, extra) {
    const units = this._resolveUnits(gameState, node, extra);
    let count = 0;
    for (const unit of units) {
      gameState.modifierStack.apply({
        sourceId: extra.sourceId,
        sourceType: this._sourceType(extra),
        targetId: unit.id,
        type: "ability-augment",
        key: "augment",
        value: 1,
        meta: { effect: node.effect },
      });
      count++;
    }
    return { applied: count > 0, count };
  }

  /**
   * Compute a card's effective play cost: base − compression, plus the card's
   * own `modify_cost` effects (evaluated against `owner`), plus board-wide
   * `stat: cost` modifiers keyed to `owner` and matching the card.
   *
   * @param {Card} card — the card instance being played
   * @param {string} owner — the acting player's username
   * @param {GameState} gameState
   */
  static getEffectiveCost(card, owner, gameState) {
    let cost = (card.cost ?? 0) - (card.costReduction ?? 0);

    for (const effect of card.effects || []) {
      if (effect.type === "modify_cost") {
        if (!effect.if || PredicateEvaluator.evaluate(effect.if, gameState, { owner, sourceOwner: owner })) {
          cost += effect.amount;
        }
      }
    }

    const mods = gameState.modifierStack.getModifiers(owner, "stat");
    for (const m of mods) {
      if (m.disabledCount !== 0 || m.key !== "cost") continue;
      const meta = m.meta || {};
      if (meta.cardType && meta.cardType !== card.type) continue;
      if (meta.affiliations && meta.affiliations.length > 0) {
        const cardAffiliations = new Set(Object.keys(card.affiliations || {}));
        if (!meta.affiliations.some((a) => cardAffiliations.has(a))) continue;
      }
      cost += typeof m.value === "number" ? m.value : 0;
    }

    return Math.max(0, cost);
  }
}
