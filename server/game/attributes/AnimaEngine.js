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

import EVT from "../EventCatalog.js";
import CombatSlotService from "../services/CombatSlotService.js";

export default class AnimaEngine {
  constructor(eventBus) {
    this._bus = eventBus;
  }

  onDeploy(unit, gameState) {
    if (!unit || !gameState) return;

    const unsub = this._bus.on(EVT.ROUND_START, () => {
      this._grantShinheuhSlot(unit.owner, gameState);
    }, { phase: "execute" });

    if (!unit._animaCleanup) unit._animaCleanup = [];
    unit._animaCleanup.push(unsub);
  }

  _grantShinheuhSlot(owner, gameState) {
    const player = gameState.playerStates[owner];
    if (!player) return;

    const hasAnima = this._hasAnimaOnField(owner, gameState);
    if (!hasAnima) {
      CombatSlotService.revokeShinheuhSlot(player);
      return;
    }

    CombatSlotService.grantShinheuhSlot(player, this._bus, owner);
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

  static consumeSlot(owner, gameState) {
    return CombatSlotService.consumeShinheuhSlot(gameState.playerStates[owner]);
  }

  static resetSlot(owner, gameState) {
    CombatSlotService.resetShinheuhSlot(gameState.playerStates[owner]);
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
