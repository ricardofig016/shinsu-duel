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
    this._reEvaluating = new Set();
  }

  registerUnit(unit, gameState) {
    const passives = unit.card.passiveAbilities || [];
    passives.forEach((passive, index) => {
      const sourceId = IdFactory.passiveSource(unit.id, index);

      // A passive without a `trigger` is always-on: its effect must track the
      // live board. Phase C wires `conditional` passives (the only always-on
      // type resolvable now); always-on modifiers and trait grants land in
      // later phases and remain skipped.
      if (!passive?.trigger || typeof passive.trigger !== "object") {
        if (passive?.type === "conditional") {
          this._subscribeAlwaysOn(unit, passive, sourceId, gameState);
        }
        return;
      }

      const trigger = this._parseTrigger(passive);
      if (!trigger) return; // unsupported trigger type — later phase

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

  /**
   * Subscribe an always-on `conditional` passive to board events so it
   * re-evaluates whenever the state its predicate reads may have changed.
   *
   * On each relevant event, the passive's prior grants are revoked by source
   * and re-resolved — a predicate that is no longer true stops applying
   * ("while i am alone on the frontline"), and one that just became true
   * starts applying. Re-apply is idempotent because every grant is tracked
   * under the passive's source ID.
   */
  _subscribeAlwaysOn(unit, passive, sourceId, gameState) {
    const events = [
      EVT.ROUND_START,
      EVT.UNIT_SUMMONED,
      EVT.UNIT_DESTROYED,
      EVT.UNIT_POSITION_SWITCHED,
      EVT.UNIT_EVOLVED,
      EVT.EQUIPMENT_ATTACHED,
      EVT.EQUIPMENT_DETACHED,
      EVT.EQUIPMENT_IGNITED,
      EVT.MODIFIER_GRANTED("trait"),
      EVT.MODIFIER_REVOKED("trait"),
      EVT.MODIFIER_GRANTED("condition"),
      EVT.MODIFIER_REVOKED("condition"),
    ];

    for (const eventName of events) {
      const unsubscribe = this._bus.on(eventName, (payload, context) => {
        // A re-evaluation revokes and re-applies its own grants, which emit
        // the very modifier events subscribed above. Guard per source so that
        // self (and synchronous mutual) re-triggering cannot recurse.
        if (this._reEvaluating.has(sourceId)) return;
        if (!this._matches(passive, unit, payload, gameState)) return;
        this._reEvaluating.add(sourceId);
        try {
          gameState.modifierStack.removeBySource(sourceId);
          resolveEffect(passive, context, gameState, {
            owner: unit.owner,
            sourceId,
            sourceType: "passive",
            sourceUnit: unit,
            sourceOwner: unit.owner,
            targetOwner: gameState.usernames.find((username) => username !== unit.owner),
          });
        } finally {
          this._reEvaluating.delete(sourceId);
        }
      }, { phase: "execute", priority: -100 });

      const entries = this._unsubscribers.get(unit.id) || [];
      entries.push(unsubscribe);
      this._unsubscribers.set(unit.id, entries);
    }
  }

  unregisterUnit(unitId) {
    for (const unsubscribe of this._unsubscribers.get(unitId) || []) unsubscribe();
    this._unsubscribers.delete(unitId);
  }

  /**
   * Revoke every always-on grant a card's passives hold on a unit (keyed
   * `Passive#<unitId>#<index>`). Call after unsubscribing the outgoing card's
   * handlers so the revoke events cannot re-trigger them, and before the
   * incoming card re-registers.
   */
  revokeGrants(unitId, passives, gameState) {
    for (let index = 0; index < passives.length; index++) {
      gameState.modifierStack.removeBySource(IdFactory.passiveSource(unitId, index));
    }
  }

  _parseTrigger(passive) {
    const trigger = passive?.trigger;
    if (!trigger || typeof trigger !== "object") return null;

    if (trigger.type === "round_start") {
      return { eventName: EVT.ROUND_START, effect: passive };
    }
    if (trigger.type === "round_end") {
      return { eventName: EVT.ROUND_END, effect: passive };
    }

    // Other trigger types and always-on modifiers are not yet wired here —
    // they land in later phases. Skip registration.
    return null;
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
