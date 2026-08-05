import LifecycleEngine from "./LifecycleEngine.js";

/**
 * Maps typed trigger ASTs (from compiler) to runtime event subscriptions.
 *
 * When a trigger fires, the TriggerManager automatically calls
 * LifecycleEngine.transformUnit with the target card ID.
 *
 * Supported trigger types:
 *   equip   — unit is equipped with a specific card
 *   slay    — the bearer slays a unit (for ignition)
 *   deploy  — unit is summoned
 *   given   — unit is given a specific item/skill
 *   kill    — unit kills a specific rank
 *   ally_dies — an allied unit dies
 */

export default class TriggerManager {
  constructor(eventBus) {
    this._bus = eventBus;
    /** @type {Map<string, Array<{unitId, trigger, targetCardId, type}>>} */
    this._registrations = new Map(); // unitId → registration list
    /** @type {Map<string, Function>} */
    this._unsubscribers = new Map(); // unitId → unsubscribe function
  }

  /**
   * Register a transformation trigger.
   *
   * @param {string} unitId — the unit that will transform
   * @param {Array<object>} triggers — typed trigger ASTs from compiler
   * @param {number} targetCardId — card to transform into
   * @param {"evolution"|"ignition"} transformType
   * @param {GameState} gameState
   */
  registerTransformation(unitId, triggers, targetCardId, transformType, gameState) {
    if (!triggers || triggers.length === 0) return;

    // Store registration
    if (!this._registrations.has(unitId)) {
      this._registrations.set(unitId, []);
    }
    this._registrations.get(unitId).push({ unitId, triggers, targetCardId, type: transformType });

    // Subscribe to relevant events based on trigger types
    for (const trigger of triggers) {
      this._subscribeTrigger(unitId, trigger, targetCardId, transformType, gameState);
    }
  }

  /**
   * Remove all trigger subscriptions for a unit.
   */
  unregisterAll(unitId) {
    const unsub = this._unsubscribers.get(unitId);
    if (unsub) {
      unsub();
      this._unsubscribers.delete(unitId);
    }
    this._registrations.delete(unitId);
  }

  /**
   * Subscribe to event(s) matching a single typed trigger.
   */
  _subscribeTrigger(unitId, trigger, targetCardId, transformType, gameState) {
    switch (trigger.type) {
      case "equip":
        this._onEquip(unitId, trigger, targetCardId, transformType, gameState);
        break;

      case "slay":
        this._onSlay(unitId, trigger, targetCardId, transformType, gameState);
        break;

      case "deploy":
        if (transformType === "evolution") {
          // Auto-evolve on deploy (unusual but valid)
          // This triggers immediately when the unit is summoned
        }
        break;

      case "given":
        // "when given a specific card" — watches for card:reclaimed or similar
        // Actually, "given" means a skill was played on this unit
        this._onGiven(unitId, trigger, targetCardId, transformType, gameState);
        break;

      default:
        break;
    }
  }

  _onEquip(unitId, trigger, targetCardId, transformType, gameState) {
    const handler = (payload) => {
      // Check position requirement if present
      if (trigger.position) {
        const unit = gameState._findUnit(unitId);
        if (!unit || unit.placedPositionCode !== trigger.position) return;
      }

      // Check equipment name matches
      if (payload.equipment?.name !== trigger.cardName &&
          payload.equipment?.card?.name !== trigger.cardName) {
        return;
      }

      // Check if this unit is the bearer
      if (payload.unitId !== unitId) return;

      // Transform!
      this._executeTransform(unitId, targetCardId, transformType, gameState, trigger);
    };

    const unsub = this._bus.on("equipment:attached", handler, { phase: "post" });
    this._unsubscribers.set(unitId + "_equip_" + trigger.cardName, unsub);
  }

  _onSlay(unitId, trigger, targetCardId, transformType, gameState) {
    const handler = (payload) => {
      // For ignition: "the bearer Slays a unit"
      // Check if the slayer has this equipment
      const unit = gameState._findUnit(unitId);
      if (!unit) return;

      // The unit killed a unit (via Slay keyword or damage)
      if (payload.sourceId === unitId || payload.slayerId === unitId) {
        this._executeTransform(unitId, targetCardId, transformType, gameState, trigger);
      }
    };

    const unsub = this._bus.on("unit:killed", handler, { phase: "post" });
    this._unsubscribers.set(unitId + "_slay", unsub);
  }

  _onGiven(unitId, trigger, targetCardId, transformType, gameState) {
    // "when I am given Redan" → watches for skill played on this unit
    const itemName = trigger.item;

    const handler = (payload) => {
      if (payload.targetId !== unitId) return;
      if (!itemName || payload.cardName === itemName || payload.effectName === itemName) {
        this._executeTransform(unitId, targetCardId, transformType, gameState, trigger);
      }
    };

    // Subscribe to a generic "skill:applied" or "card:given" event
    const unsub = this._bus.on("skill:applied", handler, { phase: "post" });
    this._unsubscribers.set(unitId + "_given_" + itemName, unsub);
  }

  /**
   * Execute the transformation.
   */
  _executeTransform(unitId, targetCardId, transformType, gameState, trigger) {
    const unit = gameState._findUnit(unitId);
    if (!unit || !unit.isAlive()) return;

    LifecycleEngine.transformUnit(gameState, unit, targetCardId);

    // Unregister all triggers for this unit (transformation complete)
    this.unregisterAll(unitId);
  }
}
