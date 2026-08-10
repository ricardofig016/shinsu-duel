import EVT from "../EventCatalog.js";

/**
 * Authoritative service for ALL combat slot management.
 *
 * Each player has 5 position combat slots plus a Shinheuh slot.
 * No other code may mutate these slots directly — all slot read/write
 * goes through this service.
 *
 * RULES.md §Resources: Combat Slots
 */
export default class CombatSlotService {
  // ── Position combat slots ────────────────────────────────────────────

  static isAvailable(playerState, positionCode) {
    const slot = playerState?.combatSlots?.[positionCode];
    return slot ? slot.available : true;
  }

  static consume(playerState, positionCode) {
    const slot = playerState?.combatSlots?.[positionCode];
    if (!slot || !slot.available) return false;
    slot.available = false;
    return true;
  }

  static resetAll(playerState) {
    if (!playerState?.combatSlots) return;
    for (const code of Object.keys(playerState.combatSlots)) {
      playerState.combatSlots[code].available = true;
    }
  }

  // ── Shinheuh combat slot (Anima attribute) ───────────────────────────

  static isShinheuhSlotAvailable(playerState) {
    return playerState?.shinheuhSlot?.available === true;
  }

  static consumeShinheuhSlot(playerState) {
    if (!playerState?.shinheuhSlot?.available) return false;
    playerState.shinheuhSlot.available = false;
    playerState.shinheuhSlot.used = true;
    return true;
  }

  static grantShinheuhSlot(playerState, eventBus, owner) {
    if (!playerState) return;
    if (!playerState.shinheuhSlot) {
      playerState.shinheuhSlot = { available: false, used: false };
    }
    const slot = playerState.shinheuhSlot;
    if (!slot.available && !slot.used) {
      slot.available = true;
      if (eventBus) eventBus.emit(EVT.SHINHEUH_SLOT_GRANTED, { owner });
    }
  }

  static revokeShinheuhSlot(playerState) {
    if (playerState?.shinheuhSlot) {
      playerState.shinheuhSlot.available = false;
    }
  }

  static resetShinheuhSlot(playerState) {
    if (playerState?.shinheuhSlot) {
      playerState.shinheuhSlot.available = false;
      playerState.shinheuhSlot.used = false;
    }
  }
}
