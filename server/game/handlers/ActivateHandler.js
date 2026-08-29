import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Activates a unit by emitting the Activation event.
 *
 * DSL type: activate
 *
 * Each ACTIVATION event re-fires the target's `activation`-triggered passives
 * (PassiveManager) and transformations (TriggerManager), so "activate the
 * Conduit" replays its round-start effects. `amount` models multi-activation
 * text ("activate twice"); it defaults to 1.
 *
 * Payload:
 *   { targetId, amount? }  — or { targetIds: [...], amount? } for multiple targets
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class ActivateHandler extends BaseHandler {
  validate(payload) {
    if (payload.targetIds !== undefined) {
      if (!Array.isArray(payload.targetIds) || payload.targetIds.length === 0) {
        throw new Error("ActivateHandler: payload.targetIds must be a non-empty array");
      }
      payload.targetIds.forEach((targetId, index) => {
        if (!targetId) throw new Error(`ActivateHandler: payload.targetIds[${index}] is required`);
      });
    } else if (!payload.targetId) {
      throw new Error("ActivateHandler: payload.targetId is required");
    }
    if (payload.amount !== undefined) BaseHandler.requirePositiveInt(payload.amount, "amount");
  }

  execute(payload, context, gameState) {
    const amount = payload.amount ?? 1;
    const targetIds = payload.targetIds ?? [payload.targetId];

    const activated = [];
    for (const targetId of targetIds) {
      const unit = gameState._findUnit(targetId);
      if (!unit || !unit.isAlive()) continue;
      activated.push(unit);
      for (let i = 0; i < amount; i++) {
        context.emitChild(EVT.ACTIVATION, {
          unitId: unit.id,
          unit,
          username: unit.owner,
        });
      }
    }

    if (payload.targetIds) {
      return { activated: activated.length > 0, activatedCount: activated.length, amount };
    }
    return activated.length > 0 ? { activated: true, amount } : { activated: false };
  }
}
