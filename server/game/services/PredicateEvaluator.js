/**
 * Pure predicate evaluator for `conditional` nodes and always-on modifiers.
 *
 * Predicates are the `if` clause of a `conditional` node (and, later, an
 * always-on modifier's gate). Each predicate asks a question about the current
 * board or deck state and returns a boolean. The evaluator performs no
 * mutation — it reads authoritative state (fields, equipment, starting-deck
 * history) through `TargetResolver` and `GameState` and never writes.
 */

import TargetResolver from "../TargetResolver.js";
import { findCardsBySeries } from "../utils/cardData.js";

export default class PredicateEvaluator {
  /**
   * Evaluate a predicate, applying its optional `negate` flag last.
   *
   * @param {object} predicate — { type, ...fields, negate? }
   * @param {GameState} gameState
   * @param {object} extra — effect resolution context ({ owner, sourceOwner, sourceId, sourceUnit })
   * @returns {boolean}
   */
  static evaluate(predicate, gameState, extra = {}) {
    if (!predicate || typeof predicate !== "object" || !predicate.type) {
      throw new Error("PredicateEvaluator: predicate must be an object with a `type`");
    }

    const owner = extra.owner || extra.sourceOwner || null;
    const result = PredicateEvaluator._evaluate(predicate, gameState, owner, extra);
    return predicate.negate ? !result : result;
  }

  static _evaluate(predicate, gameState, owner, extra) {
    switch (predicate.type) {
      case "has_unit": {
        if (!predicate.target) throw new Error("PredicateEvaluator: has_unit requires `target`");
        return TargetResolver.resolveExistenceUnits(gameState, predicate.target, owner).length > 0;
      }

      case "alone_on_line": {
        if (!predicate.line) throw new Error("PredicateEvaluator: alone_on_line requires `line`");
        const unit = extra.sourceUnit || gameState._findUnit(extra.sourceId);
        if (!unit || !unit.isAlive()) return false;
        const line = (gameState.playerStates[unit.owner]?.field?.[predicate.line] || [])
          .filter((u) => u.isAlive());
        return line.length === 1 && line[0].id === unit.id;
      }

      case "started_with_card": {
        if (!predicate.cardName) throw new Error("PredicateEvaluator: started_with_card requires `cardName`");
        if (!owner) return false;
        return gameState.startedWithCard(owner, predicate.cardName);
      }

      case "has_equipped": {
        if (!predicate.cardName) throw new Error("PredicateEvaluator: has_equipped requires `cardName`");
        const unit = extra.sourceUnit || gameState._findUnit(extra.sourceId);
        const expected = predicate.cardName.toLowerCase();
        return (unit?.equipmentAttachments || []).some((c) => c.name.toLowerCase() === expected);
      }

      case "has_all_equipped": {
        if (!predicate.series) {
          throw new Error("PredicateEvaluator: has_all_equipped requires a `series`");
        }
        const unit = extra.sourceUnit || gameState._findUnit(extra.sourceId);
        const seriesCards = findCardsBySeries(
          gameState.cards,
          predicate.series,
          "equipment"
        );
        if (seriesCards.length === 0) return false;
        const equipped = new Set((unit?.equipmentAttachments || []).map((c) => c.name.toLowerCase()));
        return seriesCards.every((card) => equipped.has(card.name.toLowerCase()));
      }

      case "has_equipment_count": {
        if (!Number.isInteger(predicate.amount) || predicate.amount < 1) {
          throw new Error("PredicateEvaluator: has_equipment_count requires a positive integer `amount`");
        }
        const unit = extra.sourceUnit || gameState._findUnit(extra.sourceId);
        return (unit?.equipmentAttachments || []).length >= predicate.amount;
      }

      case "has_condition": {
        if (!predicate.condition) throw new Error("PredicateEvaluator: has_condition requires `condition`");
        const descriptor = { ...(predicate.target || { side: "any" }), condition: predicate.condition };
        if (predicate.conditionValue !== undefined) descriptor.conditionValue = predicate.conditionValue;
        return TargetResolver.resolveExistenceUnits(gameState, descriptor, owner).length > 0;
      }

      default:
        throw new Error(`PredicateEvaluator: unknown predicate type "${predicate.type}"`);
    }
  }
}
