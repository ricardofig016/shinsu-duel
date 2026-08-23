import LifecycleEngine from "./LifecycleEngine.js";
import EVT from "../EventCatalog.js";
import { matchesTriggerSource } from "../utils/triggerSource.js";

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
    /** @type {Map<string, Array<{unitId, triggers, targetCardId, type}>>} */
    this._registrations = new Map();
    /** @type {Map<string, Array<{type: string, unsubscribe: Function}>>} */
    this._unsubscribers = new Map();
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
  registerTransformation(unitId, triggers, targetCardId, transformType, gameState, equipmentId = null) {
    if (!triggers || triggers.length === 0) return;

    // Store registration
    if (!this._registrations.has(unitId)) {
      this._registrations.set(unitId, []);
    }
    this._registrations.get(unitId).push({ unitId, triggers, targetCardId, type: transformType, equipmentId });

    // Subscribe to relevant events based on trigger types
    for (const trigger of triggers) {
      this._subscribeTrigger(unitId, trigger, targetCardId, transformType, gameState, equipmentId);
    }
  }

  /**
   * Remove all trigger subscriptions for a unit.
   */
  unregisterAll(unitId, transformType = null, equipmentId = null) {
    const subscriptions = this._unsubscribers.get(unitId) || [];
    const retained = [];
    for (const subscription of subscriptions) {
      if ((!transformType || subscription.type === transformType) &&
          (!equipmentId || subscription.equipmentId === equipmentId)) {
        subscription.unsubscribe();
      } else {
        retained.push(subscription);
      }
    }
    if (retained.length > 0) this._unsubscribers.set(unitId, retained);
    else this._unsubscribers.delete(unitId);

    const registrations = this._registrations.get(unitId) || [];
    const remainingRegistrations = transformType
      ? registrations.filter((registration) => registration.type !== transformType)
      : [];
    if (remainingRegistrations.length > 0) this._registrations.set(unitId, remainingRegistrations);
    else this._registrations.delete(unitId);
  }

  _trackUnsubscriber(unitId, type, unsubscribe, equipmentId = null) {
    const subscriptions = this._unsubscribers.get(unitId) || [];
    subscriptions.push({ type, unsubscribe, equipmentId });
    this._unsubscribers.set(unitId, subscriptions);
  }

  /**
   * Subscribe to event(s) matching a single typed trigger.
   */
  _subscribeTrigger(unitId, trigger, targetCardId, transformType, gameState, equipmentId = null) {
    switch (trigger.type) {
      case "equip":
        this._onEquip(unitId, trigger, targetCardId, transformType, gameState, equipmentId);
        break;

      case "slay":
        this._onSlay(unitId, trigger, targetCardId, transformType, gameState, equipmentId);
        break;

      case "deploy":
        this._subscribeEvent(unitId, EVT.UNIT_SUMMONED, targetCardId, transformType, gameState,
          (payload) => payload.unitId === unitId, equipmentId);
        break;
      case "given":
        this._onGiven(unitId, trigger, targetCardId, transformType, gameState);
        break;
      case "kill":
        this._subscribeEvent(unitId, EVT.UNIT_KILLED, targetCardId, transformType, gameState,
          (payload) => (payload.killerId === unitId || payload.sourceId === unitId) &&
            (!trigger.rank || gameState._findUnit(payload.targetId)?.card?.rank === trigger.rank) &&
            (!trigger.target || trigger.target === "unit"));
        break;
      case "ally_dies":
        this._subscribeEvent(unitId, EVT.UNIT_DESTROYED, targetCardId, transformType, gameState,
          (payload) => {
            const owner = gameState._findUnit(unitId)?.owner;
            return Boolean(owner && payload.owner === owner && payload.unitId !== unitId);
          });
        break;
      case "damaged_by":
        this._subscribeEvent(unitId, EVT.DAMAGE_APPLIED, targetCardId, transformType, gameState,
          (payload) => payload.targetId === unitId &&
            matchesTriggerSource(gameState._findUnit(payload.sourceId), trigger.source));
        break;
      case "round_start":
        this._subscribeEvent(unitId, EVT.ROUND_START, targetCardId, transformType, gameState, () => true);
        break;
      case "round_end":
        this._subscribeEvent(unitId, EVT.ROUND_END, targetCardId, transformType, gameState, () => true);
        break;
      case "deal_damage":
        this._subscribeEvent(unitId, EVT.DAMAGE_APPLIED, targetCardId, transformType, gameState,
          (payload) => payload.sourceId === unitId);
        break;
      case "ability_used":
        this._subscribeEvent(unitId, EVT.UNIT_ABILITY_USED, targetCardId, transformType, gameState,
          (payload) => payload.unitId === unitId);
        break;
      case "has_all_equipped":
        this._onHasAllEquipped(unitId, trigger, targetCardId, transformType, gameState, equipmentId);
        break;
      default:
        throw new Error(`Unsupported compiled trigger type: ${trigger.type}`);
    }
  }

  _subscribeEvent(unitId, eventName, targetCardId, transformType, gameState, matches, equipmentId = null) {
    const handler = (payload) => {
      if (matches(payload)) this._executeTransform(unitId, targetCardId, transformType, gameState, equipmentId);
    };
    this._trackUnsubscriber(unitId, transformType, this._bus.on(eventName, handler, { phase: "post" }), equipmentId);
  }

  _onEquip(unitId, trigger, targetCardId, transformType, gameState, equipmentId = null) {
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
      this._executeTransform(unitId, targetCardId, transformType, gameState, equipmentId);
    };

    const unsub = this._bus.on(EVT.EQUIPMENT_ATTACHED, handler, { phase: "post" });
    this._trackUnsubscriber(unitId, transformType, unsub, equipmentId);
  }

  _onHasAllEquipped(unitId, trigger, targetCardId, transformType, gameState, equipmentId = null) {
    const check = (payload) => {
      if (payload.unitId !== unitId) return;
      const unit = gameState._findUnit(unitId);
      if (!unit || !unit.isAlive()) return;
      const equipped = new Set((unit.equipmentAttachments || []).map((c) => c.name.toLowerCase()));
      const hasAll = (trigger.cardNames || []).every((name) => equipped.has(name.toLowerCase()));
      if (hasAll) {
        this._executeTransform(unitId, targetCardId, transformType, gameState, equipmentId);
      }
    };
    const unsubAttach = this._bus.on(EVT.EQUIPMENT_ATTACHED, check, { phase: "post" });
    const unsubDetach = this._bus.on(EVT.EQUIPMENT_DETACHED, check, { phase: "post" });
    this._trackUnsubscriber(unitId, transformType, unsubAttach, equipmentId);
    this._trackUnsubscriber(unitId, transformType, unsubDetach, equipmentId);
  }

  _onSlay(unitId, trigger, targetCardId, transformType, gameState, equipmentId = null) {
    const handler = (payload) => {
      // For ignition: "the bearer Slays a unit"
      // Check if the slayer has this equipment
      const unit = gameState._findUnit(unitId);
      if (!unit) return;

      // The unit killed a unit (via Slay keyword or damage)
      if (payload.sourceId === unitId || payload.slayerId === unitId) {
        this._executeTransform(unitId, targetCardId, transformType, gameState, equipmentId);
      }
    };

    const unsub = this._bus.on(EVT.UNIT_KILLED, handler, { phase: "post" });
    this._trackUnsubscriber(unitId, transformType, unsub, equipmentId);
  }

  _onGiven(unitId, trigger, targetCardId, transformType, gameState, equipmentId = null) {
    // "when I am given Redan" → watches for skill played on this unit
    const itemName = trigger.item;

    const handler = (payload) => {
      if (payload.targetId !== unitId) return;
      if (!itemName || payload.cardName === itemName || payload.effectName === itemName) {
        this._executeTransform(unitId, targetCardId, transformType, gameState, equipmentId);
      }
    };

    // Subscribe to a generic "skill:applied" or "card:given" event
    const unsub = this._bus.on(EVT.SKILL_APPLIED, handler, { phase: "post" });
    this._trackUnsubscriber(unitId, transformType, unsub, equipmentId);
  }

  /**
   * Execute the transformation.
   */
  _executeTransform(unitId, targetCardId, transformType, gameState, equipmentId = null) {
    const unit = gameState._findUnit(unitId);
    if (!unit || !unit.isAlive()) return;

    if (transformType === "ignition") {
      LifecycleEngine.transformEquipment(gameState, unit, targetCardId, equipmentId);
    } else {
      LifecycleEngine.transformUnit(gameState, unit, targetCardId);
    }

    this.unregisterAll(unitId, transformType, equipmentId);
  }
}
