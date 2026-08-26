import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";

/**
 * Removes a unit's equipment and routes it to a destination.
 *
 * DSL type: disarm
 *
 * `to` is an object `{ zone, owner }`:
 *   - `zone`: `hand` | `discard`
 *   - `owner`: `equipment_owner` (the disarmed unit's controller) | `you`
 *     (the acting player)
 *
 * Payload:
 *   { targetId, to, sourceOwner }
 */
export default class DisarmHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("DisarmHandler: payload.targetId is required");
    if (!payload.to || typeof payload.to !== "object") {
      throw new Error("DisarmHandler: payload.to is required");
    }
  }

  execute(payload, context, gameState) {
    const { targetId, to, sourceOwner } = payload;
    const unit = gameState._findUnit(targetId);
    if (!unit || !unit.isAlive()) return { disarmed: false };

    const destOwner = to.owner === "you" ? sourceOwner : unit.owner;
    const detached = LifecycleEngine.disarmUnit(gameState, unit, {
      zone: to.zone,
      owner: destOwner,
    });
    if (detached === 0) return { disarmed: false, reason: "no equipment" };

    return { disarmed: true, detached };
  }
}
