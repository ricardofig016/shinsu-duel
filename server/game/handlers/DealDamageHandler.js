import BaseHandler from "./BaseHandler.js";

/**
 * Resolves damage through Barrier → Resilient → apply → kill check → Slay.
 *
 * Payload:
 *   { sourceId, targetId, amount, sourceOwner, targetOwner }
 *
 * Emits children:
 *   - unit:damage:applied  (after damage is resolved)
 *   - unit:killed           (if HP reaches 0)
 */
export default class DealDamageHandler extends BaseHandler {
  validate(payload) {
    if (typeof payload.amount !== "number" || payload.amount < 0) {
      throw new Error("DealDamageHandler: payload.amount must be a non-negative number");
    }
    if (!payload.targetId) {
      throw new Error("DealDamageHandler: payload.targetId is required");
    }
  }

  execute(payload, context, gameState) {
    const { targetId, amount } = payload;
    const modStack = gameState.modifierStack;
    let damage = amount;

    // Barrier: negate first damage each round
    const barrierMods = modStack.getModifiers(targetId, "trait")
      .filter((m) => m.key === "barrier" && m.enabled);
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
        context.emitChild("unit:barrier:absorbed", { targetId, originalAmount: amount });
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
    const preResult = context.emitChild("unit:damage:intent", {
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
    const actualDamage = Math.min(damage, unit.currentHp);
    unit.currentHp -= actualDamage;

    context.emitChild("unit:damage:applied", {
      sourceId: payload.sourceId,
      targetId,
      amount: actualDamage,
      remainingHp: unit.currentHp,
    });

    // Kill check
    if (!unit.isAlive()) {
      context.emitChild("unit:killed", {
        sourceId: payload.sourceId,
        targetId,
        killerId: payload.sourceId,
        killerOwner: payload.sourceOwner,
      });

      // Destroy the unit
      context.emitChild("unit:destroyed", {
        unitId: targetId,
        owner: payload.targetOwner,
      });
    }

    return { damageDealt: actualDamage, killed: !unit.isAlive() };
  }
}
