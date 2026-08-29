import BaseHandler from "./BaseHandler.js";
import shuffle from "../utils/shuffle.js";

/**
 * Grants the target unit one affiliation taken from a donor unit's pool.
 *
 * DSL type: grant_affiliation
 *
 * The donor is pre-resolved by EffectResolver into `sourceUnitId` through the
 * structured `source` descriptor (the single source-descriptor path shared
 * with copy_traits / copy_ability). The donor's pool is its native card
 * affiliations unioned with modifier-granted ones, so a granted affiliation
 * can chain exactly as every affiliation reader sees it. The grant is a
 * source-tracked ModifierStack entry of type `affiliation`: its lifetime is
 * the engine's ordinary modifier lifetime, identical to an ability-applied
 * condition (revoked when the source leaves play, removed when the target
 * leaves the board).
 *
 * Payload:
 *   { targetId, sourceUnitId, sourceId, sourceType? }
 */
export default class GrantAffiliationHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("GrantAffiliationHandler: payload.targetId is required");
    if (!payload.sourceUnitId) throw new Error("GrantAffiliationHandler: payload.sourceUnitId is required");
  }

  execute(payload, context, gameState) {
    const { targetId, sourceUnitId, sourceId, sourceType = "unit" } = payload;
    const donor = gameState._findUnit(sourceUnitId);

    const pool = [...new Set([
      ...Object.keys(donor?.card?.affiliations || {}),
      ...gameState.modifierStack.getActiveKeys(sourceUnitId, "affiliation"),
    ])];

    if (pool.length === 0) return { granted: false, reason: "no affiliation to copy" };

    const key = shuffle(pool, gameState._rng)[0];

    const mod = gameState.modifierStack.apply({
      sourceId,
      sourceType,
      targetId,
      type: "affiliation",
      key,
      value: 1,
      operation: "add",
    });

    return { granted: true, affiliation: key, modifierId: mod.id };
  }
}
