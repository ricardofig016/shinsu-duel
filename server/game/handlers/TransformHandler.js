import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import { findCardsByName } from "../utils/cardData.js";

/**
 * Replaces the source unit with another unit card (transform / revert).
 *
 * DSL type: transform
 *
 * `transform` targets the source unit itself (payload.sourceUnit) and swaps
 * its card definition via `LifecycleEngine.transformUnit`, which preserves
 * HP delta, conditions, equipment, and position. Used for reverts (e.g.
 * "Khun Ran II" reverting to "Khun Ran").
 *
 * Payload:
 *   { sourceId, sourceUnit, cardName }
 */
export default class TransformHandler extends BaseHandler {
  validate(payload) {
    if (!payload.cardName) throw new Error("TransformHandler: payload.cardName is required");
  }

  execute(payload, context, gameState) {
    const unit = payload.sourceUnit || gameState._findUnit(payload.sourceId);
    if (!unit || !unit.isAlive()) return { transformed: false };

    const matches = findCardsByName(gameState.cards, payload.cardName, "unit");
    if (matches.length === 0) {
      throw new Error(`TransformHandler: no unit card named "${payload.cardName}"`);
    }

    const oldName = unit.card.name;
    LifecycleEngine.transformUnit(gameState, unit, matches[0].cardId);

    return { transformed: true, from: oldName, to: unit.card.name };
  }
}
