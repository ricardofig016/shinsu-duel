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
import { findCardsByName, findCardsBySeries } from "../utils/cardData.js";

export default class HwayeomsaEngine {
  constructor(eventBus, cards) {
    this._bus = eventBus;
    this._cards = cards;
    // Incinerate levels are derived from card data (series: incinerate +
    // generated_by.amount), not hardcoded — the card definitions are the
    // single source of truth for the charge cost of each level.
    this._incinerateLevels = this._deriveIncinerateLevels();
  }

  _deriveIncinerateLevels() {
    return findCardsBySeries(this._cards, "incinerate", "skill")
      .map((card) => {
        const generatedBy = card.deckConstraints?.find((c) => c.type === "generated_by");
        return { card, name: card.name, chargesNeeded: generatedBy?.amount ?? 0 };
      })
      .filter((entry) => entry.chargesNeeded > 0)
      .sort((a, b) => a.chargesNeeded - b.chargesNeeded)
      .map((entry, index) => ({
        level: index + 1,
        name: entry.name,
        chargesNeeded: entry.chargesNeeded,
        card: entry.card,
      }));
  }

  /**
   * Called when a Hwayeomsa unit is deployed.
   */
  onDeploy(unit, gameState) {
    if (!unit || !gameState) return;

    // Initialize fire charges if not present
    const player = gameState.playerStates[unit.owner];
    if (player && typeof player.fireCharges !== "number") {
      gameState._modifyFireCharges(unit.owner, 0);
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
    gameState._modifyFireCharges(username, 1);

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

    const config = this._incinerateLevels.find((l) => l.level === level);
    if (!config) return null;

    if ((player.fireCharges || 0) < config.chargesNeeded) {
      return null; // insufficient charges
    }

    // Consume charges
    gameState._modifyFireCharges(username, -config.chargesNeeded);

    // Create the Incinerate card instance in hand
    const cardData = config.card;
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

    return this._incinerateLevels
      .filter((config) => charges >= config.chargesNeeded)
      .map(({ level, name }) => ({ level, name }));
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
    return findCardsByName(this._cards, name)[0] ?? null;
  }
}
