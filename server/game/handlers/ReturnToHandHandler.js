import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";

/**
 * Returns a target unit from the battlefield to its owner's hand.
 *
 * DSL type: return_to_hand
 *
 * The transition is not a kill and not a discard: it routes through
 * `LifecycleEngine.returnUnitToHand`, so no death or destroy semantics fire
 * and the card instance lands back in the hand. A bearer with
 * `retain_equipment` keeps its attachments through the trip.
 *
 * Payload:
 *   { targetId }
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class ReturnToHandHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("ReturnToHandHandler: payload.targetId is required");
  }

  execute(payload, context, gameState) {
    const unit = gameState._findUnit(payload.targetId);
    if (!unit || !unit.isAlive()) return { returned: false };

    return LifecycleEngine.returnUnitToHand(gameState, unit);
  }
}
