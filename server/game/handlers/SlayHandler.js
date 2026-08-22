import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";

/**
 * Kills a target unit directly through the full lethal pipeline.
 *
 * DSL type: slay
 *
 * `slay` ignores damage: the unit is killed regardless of its current HP.
 * The death still routes through `LifecycleEngine.killUnit`, so Undying can
 * intercept and on-kill triggers (e.g. Narumada's ignition) still fire.
 *
 * Payload:
 *   { sourceId, targetId, sourceOwner }
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class SlayHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("SlayHandler: payload.targetId is required");
  }

  execute(payload, context, gameState) {
    const { targetId } = payload;
    const unit = gameState._findUnit(targetId);
    if (!unit || !unit.isAlive()) return { slayed: false };

    const result = LifecycleEngine.killUnit(gameState, unit, {
      sourceId: payload.sourceId,
      sourceOwner: payload.sourceOwner || payload.owner,
      context,
      damage: 0,
    });

    return { slayed: result.killed, undyingSaved: result.undyingSaved === true };
  }
}
