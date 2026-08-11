import * as IdFactory from "../IdFactory.js";
import { resolveEffect } from "../EffectResolver.js";
import EVT from "../EventCatalog.js";

/**
 * Registers compiled, event-driven passives for a unit while it is on field.
 * Every subscription is owned by the unit and removed on its lifecycle exit.
 */
export default class PassiveManager {
  constructor(eventBus) {
    this._bus = eventBus;
    this._unsubscribers = new Map();
  }

  registerUnit(unit, gameState) {
    const passives = unit.card.passiveAbilities || [];
    passives.forEach((passive, index) => {
      const trigger = this._parseTrigger(passive);
      if (!trigger) return;

      const sourceId = IdFactory.passiveSource(unit.id, index);
      const unsubscribe = this._bus.on(trigger.eventName, (payload, context) => {
        if (!this._matches(trigger, unit, payload, gameState)) return;
        resolveEffect(trigger.effect, context, gameState, {
          owner: unit.owner,
          sourceId,
          sourceType: "passive",
          sourceUnit: unit,
          sourceOwner: unit.owner,
          targetOwner: gameState.usernames.find((username) => username !== unit.owner),
        });
      }, { phase: "execute", priority: -100 });

      const entries = this._unsubscribers.get(unit.id) || [];
      entries.push(unsubscribe);
      this._unsubscribers.set(unit.id, entries);
    });
  }

  unregisterUnit(unitId) {
    for (const unsubscribe of this._unsubscribers.get(unitId) || []) unsubscribe();
    this._unsubscribers.delete(unitId);
  }

  _parseTrigger(passive) {
    if (!passive?.trigger || passive.type === "custom") return null;

    return {
      eventName: passive.trigger === "round start" ? EVT.ROUND_START : EVT.ROUND_END,
      effect: passive,
    };
  }

  _matches(trigger, unit, payload, gameState) {
    // Disabled suppresses timed passives (RULES.md §Conditions).
    // Always-on passive modifiers (traits, stat buffs) stored in the
    // ModifierStack are automatically suppressed by getEffective /
    // getActiveKeys respecting disabledCount — no extra wiring needed.
    if (gameState.modifierStack.has(unit.id, "condition", "disabled")) return false;
    return gameState._findUnit(unit.id) === unit && unit.isAlive();
  }
}
