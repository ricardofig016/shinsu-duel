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

    const attachments = LifecycleEngine._getEquipment(unit);
    if (attachments.length === 0) return { disarmed: false, reason: "no equipment" };

    const destOwner = to.owner === "you" ? sourceOwner : unit.owner;
    const destination = to.zone === "discard" ? "discard" : "hand";

    const detached = attachments.slice();
    LifecycleEngine._syncEquipment(unit, []);
    for (const equip of detached) {
      LifecycleEngine._detachOne(gameState, unit, equip, destination, destOwner);
    }

    return { disarmed: true, detached: detached.length };
  }
}
