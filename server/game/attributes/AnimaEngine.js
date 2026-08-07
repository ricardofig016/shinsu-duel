/**
 * Anima attribute engine — manages Shinheuh combat slots.
 *
 * Core mechanic (RULES.md):
 *   Round start: gain a single-use Shinheuh combat slot if you don't
 *   already have one.
 *
 * Shinheuh can use abilities only when a Shinheuh combat slot is available.
 * Using a Shinheuh ability consumes the slot for the round.
 */

export default class AnimaEngine {
  constructor(eventBus) {
    this._bus = eventBus;
  }

  /**
   * Called when an Anima unit is deployed. Registers round-start handler.
   */
  onDeploy(unit, gameState) {
    if (!unit || !gameState) return;

    // Subscribe to round start — create Shinheuh slot
    const unsub = this._bus.on("round:started", () => {
      this._grantShinheuhSlot(unit.owner, gameState);
    }, { phase: "execute" });

    // Store unsubscribe for cleanup
    if (!unit._animaCleanup) unit._animaCleanup = [];
    unit._animaCleanup.push(unsub);
  }

  /**
   * Grant a Shinheuh combat slot to the player.
   */
  _grantShinheuhSlot(owner, gameState) {
    const player = gameState.playerStates[owner];
    if (!player) return;

    if (!player.shinheuhSlot) {
      player.shinheuhSlot = { available: false, used: false };
    }

    // Check if any Anima unit is on the field
    const hasAnima = this._hasAnimaOnField(owner, gameState);
    if (!hasAnima) {
      player.shinheuhSlot.available = false;
      return;
    }

    // Grant slot if not already available
    if (!player.shinheuhSlot.available && !player.shinheuhSlot.used) {
      player.shinheuhSlot.available = true;
      this._bus.emit("shinheuh:slot:granted", { owner });
    }
  }

  /**
   * Check if player has an Anima unit on their field.
   */
  _hasAnimaOnField(owner, gameState) {
    const field = gameState.playerStates[owner]?.field;
    if (!field) return false;
    const allUnits = [...(field.frontline || []), ...(field.backline || [])];
    return allUnits.some((u) =>
      (u.card?.attributes || []).includes("anima") ||
      gameState.modifierStack.has(u.id, "attribute", "anima")
    );
  }

  /**
   * Consume the Shinheuh slot when a Shinheuh uses an ability.
   * Returns true if slot was available and consumed.
   */
  static consumeSlot(owner, gameState) {
    const player = gameState.playerStates[owner];
    if (!player?.shinheuhSlot?.available) return false;

    player.shinheuhSlot.available = false;
    player.shinheuhSlot.used = true;
    return true;
  }

  /**
   * Reset Shinheuh slot at round end.
   */
  static resetSlot(owner, gameState) {
    const player = gameState.playerStates[owner];
    if (player?.shinheuhSlot) {
      player.shinheuhSlot.available = false;
      player.shinheuhSlot.used = false;
    }
  }

  /**
   * Clean up subscriptions when unit leaves field.
   */
  cleanup(unit) {
    if (unit._animaCleanup) {
      for (const unsub of unit._animaCleanup) {
        unsub();
      }
      unit._animaCleanup = [];
    }
  }
}
