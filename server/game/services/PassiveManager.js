import * as IdFactory from "../IdFactory.js";
import { resolveEffect } from "../EffectResolver.js";
import ModifierService from "./ModifierService.js";
import EVT from "../EventCatalog.js";
import { matchesTriggerSource } from "../utils/triggerSource.js";

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
      // live board. `conditional` passives and modifier nodes (`modify_*`,
      // `retain_equipment`) re-evaluate on board events; other always-on
      // branches (trait grants) resolve once and are not re-evaluated.
      if (!passive?.trigger || typeof passive.trigger !== "object") {
        if (passive?.type === "conditional" || ModifierService.isModifier(passive)) {
          this._subscribeAlwaysOn(unit, passive, sourceId, gameState);
        }
        return;
      }

      const trigger = this._parseTrigger(passive);
      if (!trigger) return; // unsupported trigger type — not yet wired

      const unsubscribe = this._bus.on(trigger.eventName, (payload, context) => {
        if (!this._matches(trigger, unit, payload, gameState)) return;
        if (gameState._globalRuleRegistry?.hasRule(unit, "disable_passives", gameState)) return;
        if (trigger.effect?.type === "choose_position") {
          this._choosePosition(unit, gameState);
          return;
        }
        resolveEffect(trigger.effect, context, gameState, this._triggerExtra(trigger, unit, payload, sourceId, gameState));
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
        // Disabled is intentionally NOT short-circuited here: the Disabled
        // grant/revoke events must reach `_applyAlwaysOn` so it revokes (and,
        // on un-Disable, re-applies) the passive's grants.
        if (!(gameState._findUnit(unit.id) === unit && unit.isAlive())) return;
        this._reEvaluating.add(sourceId);
        try {
          this._applyAlwaysOn(unit, passive, sourceId, context, gameState);
        } finally {
          this._reEvaluating.delete(sourceId);
        }
      }, { phase: "execute", priority: -100 });

      const entries = this._unsubscribers.get(unit.id) || [];
      entries.push(unsubscribe);
      this._unsubscribers.set(unit.id, entries);
    }
  }

  /**
   * Apply (or revoke) a single always-on passive against the live board.
   *
   * Revokes the passive's prior grants by source, then re-applies: a
   * `conditional` resolves through the effect resolver; a modifier node
   * applies through `ModifierService`. Position-scoped passives apply only
   * while the source unit occupies their gated position.
   */
  _applyAlwaysOn(unit, passive, sourceId, context, gameState) {
    if (gameState._globalRuleRegistry?.hasRule(unit, "disable_passives", gameState)) {
      ModifierService.revokeBySource(gameState, sourceId);
      return;
    }
    const extra = {
      owner: unit.owner,
      sourceId,
      sourceType: "passive",
      sourceUnit: unit,
      sourceOwner: unit.owner,
      targetOwner: gameState.usernames.find((username) => username !== unit.owner),
    };

    // Disabled turns passives off entirely. 
    // Revoke the passive's grants so a Disabled unit loses its always-on effects,
    // and re-apply them when Disabled is revoked.
    if (gameState.modifierStack.has(unit.id, "condition", "disabled")) {
      ModifierService.revokeBySource(gameState, sourceId);
      return;
    }

    if (passive.position && unit.placedPositionCode !== passive.position) {
      ModifierService.revokeBySource(gameState, sourceId);
      return;
    }

    ModifierService.revokeBySource(gameState, sourceId);
    if (ModifierService.isModifier(passive)) {
      ModifierService.applyModifier(passive, gameState, extra);
    } else {
      resolveEffect(passive, context, gameState, extra);
    }
  }

  /**
   * Resolve a landmark's deploy-time `choose_position` decision: the owner
   * picks one of the five canonical positions (not the unit's own card
   * positions — landmarks have none). The choice is stored on the unit and
   * activates any `position: "chosen"` landmark rule via `registerUnit`.
   */
  _choosePosition(unit, gameState) {
    if (unit.chosenPositionCode) return;
    // A deploy trigger can be revisited while an earlier decision is pending.
    // Leave the existing decision in charge rather than creating duplicates.
    if (gameState.pendingDecision?.type === "position_selection" && gameState.pendingDecision.owner === unit.owner) return;

    const positions = gameState.constructor.positions;
    const candidates = Object.keys(positions)
      .filter((code) => positions[code].special === false)
      .sort()
      .map((code) => ({ id: code, name: positions[code].name }));

    gameState.createPendingDecision({
      owner: unit.owner,
      type: "position_selection",
      candidates,
      minChoices: 1,
      maxChoices: 1,
      resolve: ([positionCode]) => {
        if (!candidates.some((candidate) => candidate.id === positionCode)) {
          throw new Error(`Invalid selected position: ${positionCode}`);
        }
        unit.chosenPositionCode = positionCode;
        gameState._globalRuleRegistry?.registerUnit(unit, gameState);
        gameState._globalRuleRegistry?.reconcile(gameState);
      },
    });
  }

  reapplyAll(gameState) {
    for (const [unitId] of this._unsubscribers) {
      const unit = gameState._findUnit?.(unitId);
      if (!unit || !unit.isAlive()) continue;
      for (const passive of unit.card.passiveAbilities || []) {
        if (!passive?.trigger && (passive?.type === "conditional" || ModifierService.isModifier(passive))) {
          this._applyAlwaysOn(unit, passive, IdFactory.passiveSource(unit.id, (unit.card.passiveAbilities || []).indexOf(passive)), null, gameState);
        }
      }
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
      ModifierService.revokeBySource(gameState, IdFactory.passiveSource(unitId, index));
    }
  }

  _parseTrigger(passive) {
    const trigger = passive?.trigger;
    if (!trigger || typeof trigger !== "object") return null;

    if (trigger.type === "round_start") {
      return { eventName: EVT.ROUND_START, effect: passive, type: trigger.type };
    }
    if (trigger.type === "round_end") {
      return { eventName: EVT.ROUND_END, effect: passive, type: trigger.type };
    }
    if (trigger.type === "skill_played") {
      return { eventName: EVT.SKILL_APPLIED, effect: passive, type: trigger.type, cardName: trigger.cardName };
    }
    if (trigger.type === "deal_damage") {
      return { eventName: EVT.DAMAGE_APPLIED, effect: passive, type: trigger.type };
    }
    if (trigger.type === "quick_ability_used") {
      return { eventName: EVT.UNIT_ABILITY_USED, effect: passive, type: trigger.type };
    }
    if (trigger.type === "summon") {
      return { eventName: EVT.UNIT_SUMMONED, effect: passive, type: trigger.type, source: trigger.source };
    }
    if (trigger.type === "deploy") {
      return { eventName: EVT.UNIT_SUMMONED, effect: passive, type: trigger.type };
    }

    // Other trigger types are not yet wired here. Skip registration.
    return null;
  }

  _matches(trigger, unit, payload, gameState) {
    // Disabled suppresses timed passives (RULES.md §Conditions).
    // Always-on passive modifiers (traits, stat buffs) stored in the
    // ModifierStack are automatically suppressed by getEffective /
    // getActiveKeys respecting disabledCount — no extra wiring needed.
    if (gameState.modifierStack.has(unit.id, "condition", "disabled")) return false;
    if (!(gameState._findUnit(unit.id) === unit && unit.isAlive())) return false;

    // Trigger-specific filters.
    if (trigger.type === "skill_played") {
      if (payload?.cardName !== trigger.cardName) return false;
      // "Baang gives Burned 1" — only the passive owner's own skill play.
      if (payload?.owner !== unit.owner) return false;
    }
    if (trigger.type === "deal_damage" && payload?.sourceId !== unit.id) return false;
    if (trigger.type === "quick_ability_used" && payload?.quick !== true) return false;
    if (trigger.type === "summon") {
      // "when you summon a Shinheuh" — only the passive owner's own summons,
      // and the summoned unit must match the authored `source` (kind or name).
      if (payload?.username !== unit.owner) return false;
      if (trigger.source && !matchesTriggerSource(gameState._findUnit(payload?.unitId), trigger.source)) return false;
    }
    if (trigger.type === "deploy" && payload?.unitId !== unit.id) return false;
    return true;
  }

  /**
   * Build the resolution context for a triggered passive effect, threading
   * the triggering event's payload where the effect's text is relative to
   * the actor rather than the passive source.
   *
   * - `deal_damage`: "Disarm them" → target the damaged unit.
   * - `quick_ability_used`: "they Charge 1" → the unit that used the ability.
   */
  _triggerExtra(trigger, unit, payload, sourceId, gameState) {
    const extra = {
      owner: unit.owner,
      sourceId,
      sourceType: "passive",
      sourceUnit: unit,
      sourceOwner: unit.owner,
      targetOwner: gameState.usernames.find((username) => username !== unit.owner),
    };
    if (trigger.type === "deal_damage") {
      extra.targetId = payload.targetId;
    } else if (trigger.type === "quick_ability_used") {
      extra.owner = payload.username;
    }
    return extra;
  }
}
