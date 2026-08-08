/**
 * Hwayeomsa attribute engine — manages Fire Charge accumulation
 * and Incinerate card generation.
 *
 * Core mechanic (RULES.md):
 *   Spend 1, Free: gain 1 Fire Charge, create Fire Core in hand.
 *   Fire Core: Quick — consume Fire Charges to create Incinerate I-IV.
 *   Incinerate I-IV: escalating damage/burn based on charges consumed.
 */

import ZoneService from "../services/ZoneService.js";
import ShinsuService from "../services/ShinsuService.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";

export default class HwayeomsaEngine {
  constructor(eventBus, cards) {
    this._bus = eventBus;
    this._cards = cards;
    this._incinerateLevels = {
      1: { name: "Incinerate I", chargesNeeded: 1 },
      2: { name: "Incinerate II", chargesNeeded: 3 },
      3: { name: "Incinerate III", chargesNeeded: 5 },
      4: { name: "Incinerate IV", chargesNeeded: 7 },
    };
  }

  /**
   * Called when a Hwayeomsa unit is deployed.
   */
  onDeploy(unit, gameState) {
    if (!unit || !gameState) return;

    // Initialize fire charges if not present
    const player = gameState.playerStates[unit.owner];
    if (player && typeof player.fireCharges !== "number") {
      player.fireCharges = 0;
    }
  }

  /**
   * Execute the core Hwayeomsa ability: Spend 1, Free: gain Fire Charge,
   * create Fire Core in hand.
   */
  generateFireCharge(username, gameState) {
    const player = gameState.playerStates[username];
    if (!player) throw new Error(`Player "${username}" not found`);

    // Check if a Hwayeomsa unit is on the field
    const hasHwayeomsa = this._hasHwayeomsaOnField(username, gameState);
    if (!hasHwayeomsa) return { success: false, reason: "No Hwayeomsa on field" };

    // Spend 1 shinsu
    if (gameState.getTotalShinsu(username) < 1) {
      return { success: false, reason: "Not enough shinsu" };
    }
    ShinsuService.spend(player, 1);

    // Gain fire charge
    player.fireCharges = (player.fireCharges || 0) + 1;

    // Create Fire Core in hand if not already present
    const hasFireCore = (player.hand || []).some(
      (c) => c.name === "Fire Core"
    );
    if (!hasFireCore) {
      const fireCoreData = this._findCardByName("Fire Core");
      if (fireCoreData) {
        const fireCore = new Card(
          fireCoreData.cardId,
          fireCoreData,
          username,
          gameState.eventBus
        );
        ZoneService.addToHand(player, fireCore);
      }
    }

    this._bus.emit(EVT.HWAYEOMSA_CHARGE_GAINED, {
      username,
      charges: player.fireCharges,
    });

    return { success: true, charges: player.fireCharges };
  }

  /**
   * Consume Fire Charges to create an Incinerate card.
   * Returns the Incinerate card or null if insufficient charges.
   */
  consumeCharges(username, level, gameState) {
    const player = gameState.playerStates[username];
    if (!player) return null;

    const config = this._incinerateLevels[level];
    if (!config) return null;

    if ((player.fireCharges || 0) < config.chargesNeeded) {
      return null; // insufficient charges
    }

    // Consume charges
    player.fireCharges -= config.chargesNeeded;

    // Find the Incinerate card data
    const cardData = this._findCardByName(config.name);
    if (!cardData) return null;

    // Create card instance in hand
    const incinerate = new Card(
      cardData.cardId,
      cardData,
      username,
      gameState.eventBus
    );
    ZoneService.addToHand(player, incinerate);

    this._bus.emit(EVT.HWAYEOMSA_INCINERATE_CREATED, {
      username,
      level,
      chargesRemaining: player.fireCharges,
    });

    return incinerate;
  }

  /**
   * Get available Incinerate levels based on current charges.
   * @returns {Array<{level: number, name: string}>}
   */
  getAvailableLevels(username, gameState) {
    const player = gameState.playerStates[username];
    const charges = player?.fireCharges || 0;

    return Object.entries(this._incinerateLevels)
      .filter(([, config]) => charges >= config.chargesNeeded)
      .map(([level, config]) => ({ level: parseInt(level), ...config }));
  }

  _hasHwayeomsaOnField(username, gameState) {
    const field = gameState.playerStates[username]?.field;
    if (!field) return false;
    const allUnits = [...(field.frontline || []), ...(field.backline || [])];
    return allUnits.some((u) =>
      (u.card?.attributes || []).includes("hwayeomsa")
    );
  }

  _findCardByName(name) {
    if (!this._cards) return null;
    for (const key of Object.keys(this._cards)) {
      if (this._cards[key].name === name) return this._cards[key];
    }
    return null;
  }
}
