import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import UnitService from "../services/UnitService.js";
import EVT from "../EventCatalog.js";

/**
 * Resolves damage through Barrier → Resilient → apply → kill check → Slay.
 *
 * Payload:
 *   { sourceId, targetId, amount, sourceOwner, targetOwner }
 *
 * targetId is always pre-resolved by EffectResolver before this handler runs.
 */
export default class DealDamageHandler extends BaseHandler {
  validate(payload) {
    if (typeof payload.amount !== "number" || !Number.isFinite(payload.amount) || payload.amount < 0) {
      throw new Error("DealDamageHandler: payload.amount must be a non-negative finite number");
    }
    if (!payload.targetId) {
      throw new Error("DealDamageHandler: payload.targetId is required");
    }
  }

  execute(payload, context, gameState) {
    const { amount, targetId } = payload;
    const modStack = gameState.modifierStack;
    let damage = amount;

    // Barrier: negate first damage each round
    const barrierMods = modStack.getModifiers(targetId, "trait")
      .filter((m) => m.key === "barrier" && m.disabledCount === 0);
    if (barrierMods.length > 0) {
      // Check if barrier was already used this round
      const barrierUsed = gameState._barrierUsedThisRound?.has(targetId);
      if (!barrierUsed) {
        // Track barrier usage
        if (!gameState._barrierUsedThisRound) {
          gameState._barrierUsedThisRound = new Set();
        }
        gameState._barrierUsedThisRound.add(targetId);
        damage = 0;
        context.emitChild(EVT.BARRIER_ABSORBED, { targetId, originalAmount: amount });
      }
    }

    // Resilient: reduce incoming damage
    const resilient = modStack.getEffective(targetId, "trait", "resilient");
    if (resilient > 0 && damage > 0) {
      damage = Math.max(0, damage - resilient);
    }

    // Weak condition: increase incoming damage
    const weak = modStack.getEffective(targetId, "condition", "weak");
    if (weak > 0 && damage > 0) {
      damage += weak;
    }

    // Emit pre-damage event for any last-minute modifications
    const preResult = context.emitChild(EVT.DAMAGE_INTENT, {
      sourceId: payload.sourceId,
      targetId,
      amount: damage,
      sourceOwner: payload.sourceOwner,
      targetOwner: payload.targetOwner,
    });
    if (preResult?.cancelled) return { damageDealt: 0, killed: false };

    // Apply damage to the unit
    const unit = gameState._findUnit(targetId);
    if (!unit || !unit.isAlive()) return { damageDealt: 0, killed: false };

    damage = preResult?.finalPayload?.amount ?? damage;
    const { applied: actualDamage } = UnitService.damage(unit, damage);

    context.emitChild(EVT.DAMAGE_APPLIED, {
      sourceId: payload.sourceId,
      targetId,
      amount: actualDamage,
      remainingHp: unit.currentHp,
    });

    // Kill check
    if (!unit.isAlive()) {
      // Emit cancellable death-intent before unit:killed.
      // Undying (and future cheat-death mechanics) intercept here.
      const deathResult = context.emitChild(EVT.UNIT_DEATH_INTENT, {
        sourceId: payload.sourceId,
        targetId,
        killerId: payload.sourceId,
        killerOwner: payload.sourceOwner,
        damage: actualDamage,
      });

      if (deathResult?.cancelled) {
        return { damageDealt: actualDamage, killed: false, undyingSaved: true };
      }

      context.emitChild(EVT.UNIT_KILLED, {
        sourceId: payload.sourceId,
        targetId,
        killerId: payload.sourceId,
        killerOwner: payload.sourceOwner,
      });

      // Every production lethal path uses the lifecycle engine so zones,
      // attachments, modifiers, attributes, and trigger subscriptions remain coherent.
      // The fallback keeps this handler independently testable with a minimal state stub.
      if (gameState.playerStates && gameState.eventBus) {
        LifecycleEngine.destroyUnit(gameState, unit);
      } else {
        context.emitChild(EVT.UNIT_DESTROYED, { unitId: targetId, owner: payload.targetOwner });
      }
    }

    return { damageDealt: actualDamage, killed: !unit.isAlive() };
  }
}
