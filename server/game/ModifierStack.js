import EVT from "./EventCatalog.js";

/**
 * Provenance-tracked modifier stack for all state changes in Shinsu Duel.
 *
 * Every trait, condition, stat change, and granted ability is represented
 * as a `Modifier` with a tracked source. This enables:

 *
 *  - Equipment unequip: remove only modifiers from that equipment.
 *  - Silence: disable trait modifiers without deleting them.
 *  - Cleanse: remove condition modifiers.
 *  - Unit death: remove all modifiers sourced from or targeting that unit.
 *
 * ## Modifier structure
 *
 *   {
 *     id:        unique string,
 *     sourceId:  "Equip#17" | "Unit#5" | "Passive#3",
 *     sourceType:"equipment"|"unit"|"skill"|"passive"|"landmark"|"system",
 *     targetId:  "Unit#8",
 *     type:      "trait" | "condition" | "stat" | "ability" | "keyword",
 *     key:       "barrier" | "hp" | "strong" | "burned" | "quick",
 *     value:     1 | -1 | "barrier",
 *     operation: "add" | "set" | "override",
 *     disabledCount: number (0 = active; each silence/disarm increments this;
 *                           re-enabling decrements it — reaches 0 only when
 *                           every silencing effect has been removed)
 *     priority:  number (higher is better)
 *     expiresAt: date (when the modifier expires)
 *   }
 */

let _idCounter = 0;

/** Reset the global modifier counter for deterministic replays. */
export function resetModifierCounter() {
  _idCounter = 0;
}

/** @returns {number} The current global modifier id counter. */
export function getModifierCounter() {
  return _idCounter;
}

/** @param {number} value Restore the global modifier id counter (for replay). */
export function setModifierCounter(value) {
  _idCounter = value ?? 0;
}

function nextId() {
  return `mod_${++_idCounter}`;
}

// ---------------------------------------------------------------------------
// ModifierStack
// ---------------------------------------------------------------------------

export default class ModifierStack {
  /**
   * @param {import('./EventBus.js').default} eventBus
   * @param {import('./GameClock.js').default} [clock]
   */
  constructor(eventBus, clock) {
    /** @type {import('./EventBus.js').default} */
    this._bus = eventBus;
    this._clock = clock ?? { now: () => 0 };

    /** @type {Map<string, Array<object>>}  targetId → modifiers */
    this._byTarget = new Map();

    /** @type {Map<string, Array<object>>}  sourceId → modifiers */
    this._bySource = new Map();

    /** @type {Map<string, object>}  modifierId → modifier */
    this._byId = new Map();

    // Auto-cleanup when a unit is destroyed
    this._bus.on(EVT.UNIT_DESTROYED, (payload) => {
      this.removeByTarget(payload.unitId);
    }, { phase: "post" });

    /** @type {Function|null} Called with each removed modifier for cross-system cleanup. */
    this._onRevoke = null;
  }

  /**
   * Register a callback invoked for every removed modifier.
   * Used by GameState to synchronize AbilityRegistry cleanup.
   */
  onRevoke(callback) {
    this._onRevoke = callback;
  }

  // -----------------------------------------------------------------------
  // Apply
  // -----------------------------------------------------------------------

  /**
   * Apply a modifier to the stack.
   *
   * @param {object} spec
   * @param {string} spec.sourceId
   * @param {string} spec.sourceType
   * @param {string} spec.targetId
   * @param {string} spec.type      "trait"|"condition"|"stat"|"ability"|"keyword"
   * @param {string} spec.key
   * @param {*}      spec.value
   * @param {string} [spec.operation="add"]
   * @param {number} [spec.priority=0]
   * @param {date}   [spec.expiresAt=null]
   * @returns {object} The created modifier.
   */
  apply(spec) {
    const mod = {
      id: nextId(),
      sourceId: spec.sourceId,
      sourceType: spec.sourceType || "system",
      targetId: spec.targetId,
      type: spec.type,
      key: spec.key,
      value: spec.value,
      operation: spec.operation || "add",
      disabledCount: 0,
      createdAt: this._clock.now(),
      priority: spec.priority ?? 0,
      expiresAt: spec.expiresAt ?? null,
      meta: spec.meta ?? null,
    };

    this._byId.set(mod.id, mod);

    // Index by target
    if (!this._byTarget.has(mod.targetId)) this._byTarget.set(mod.targetId, []);
    this._byTarget.get(mod.targetId).push(mod);

    // Index by source
    if (!this._bySource.has(mod.sourceId)) this._bySource.set(mod.sourceId, []);
    this._bySource.get(mod.sourceId).push(mod);

    // Emit event
    this._bus.emit(EVT.MODIFIER_GRANTED(mod.type), {
      modifier: mod,
      targetId: mod.targetId,
      key: mod.key,
      value: mod.value,
    });

    return mod;
  }

  // -----------------------------------------------------------------------
  // Removal
  // -----------------------------------------------------------------------

  /**
   * Remove all modifiers from a specific source (e.g. unequip, unit death).
   */
  removeBySource(sourceId) {
    const mods = this._bySource.get(sourceId);
    if (!mods || mods.length === 0) return;

    // Copy — we mutate during iteration
    for (const mod of [...mods]) {
      this._removeOne(mod);
    }
  }

  /**
   * Remove all modifiers on a specific target (e.g. unit destroyed).
   */
  removeByTarget(targetId) {
    const mods = this._byTarget.get(targetId);
    if (!mods || mods.length === 0) return;

    for (const mod of [...mods]) {
      this._removeOne(mod);
    }
  }

  /**
   * Remove modifiers matching a filter.
   */
  removeWhere(predicate) {
    const toRemove = [];
    for (const mod of this._byId.values()) {
      if (predicate(mod)) toRemove.push(mod);
    }
    for (const mod of toRemove) {
      this._removeOne(mod);
    }
  }

  // -----------------------------------------------------------------------
  // Enable / Disable (Silence support)
  // -----------------------------------------------------------------------

  /**
   * Suppress all modifiers of the given type(s) on a target.
   * Each call increments `disabledCount`. A modifier becomes active only
   * when every suppression has been reversed (disabledCount === 0).
   *
   * Used by Silence (traits), Disarm (equipment effects), and any future
   * effect that temporarily suppresses modifiers without deleting them.
   */
  disableByTarget(targetId, types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const mods = this._byTarget.get(targetId);
    if (!mods) return;

    for (const mod of mods) {
      if (typeSet.has(mod.type)) {
        mod.disabledCount++;
      }
    }
    this._bus.emit(EVT.MODIFIER_DISABLED, { targetId, types: [...typeSet] });
  }

  /**
   * Remove one level of suppression for the given type(s) on a target.
   * Each call decrements `disabledCount` (never below 0). A modifier
   * only becomes active when disabledCount reaches 0.
   */
  enableByTarget(targetId, types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const mods = this._byTarget.get(targetId);
    if (!mods) return;

    for (const mod of mods) {
      if (typeSet.has(mod.type) && mod.disabledCount > 0) {
        mod.disabledCount--;
      }
    }
    this._bus.emit(EVT.MODIFIER_ENABLED, { targetId, types: [...typeSet] });
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  // ── Priority-based getEffective ─────────────────────────────────────────
  //
  // Override > Set > Add precedence:
  //   If any enabled `override` exists for a key, choose the highest-
  //   priority one and ignore all `set` and `add` modifiers for that key.
  //   Otherwise, if any enabled `set` exists, choose the highest-priority
  //   one and ignore `add` modifiers.
  //   Otherwise, sum all enabled `add` modifiers.
  getEffective(targetId, type, key) {
    const mods = this._byTarget.get(targetId);
    if (!mods) return 0;

    let sumAdd = 0;
    let bestSet = null;
    let bestOverride = null;

    for (const mod of mods) {
      if (mod.disabledCount > 0 || mod.type !== type || mod.key !== key) continue;

      if (mod.operation === "override") {
        if (!bestOverride || mod.priority > bestOverride.priority ||
            (mod.priority === bestOverride.priority && mod.createdAt > bestOverride.createdAt)) {
          bestOverride = mod;
        }
        continue;
      }

      if (mod.operation === "set") {
        if (!bestSet || mod.priority > bestSet.priority ||
            (mod.priority === bestSet.priority && mod.createdAt > bestSet.createdAt)) {
          bestSet = mod;
        }
        continue;
      }

      if (mod.operation === "add") {
        sumAdd += (typeof mod.value === "number" ? mod.value : 0);
      }
    }

    if (bestOverride) return bestOverride.value;
    return bestSet ? bestSet.value : sumAdd;
  }

  /**
   * Get all enabled modifier keys for a target's type.
   * For traits/conditions, returns a Set of keys the unit currently has.
   */
  getActiveKeys(targetId, type) {
    const mods = this._byTarget.get(targetId);
    if (!mods) return new Set();

    const keys = new Set();
    for (const mod of mods) {
      if (mod.disabledCount === 0 && mod.type === type) {
        keys.add(mod.key);
      }
    }
    return keys;
  }

  /**
   * Get all modifiers for a target, optionally filtered by type.
   */
  getModifiers(targetId, type) {
    const mods = this._byTarget.get(targetId);
    if (!mods) return [];
    if (!type) return [...mods];
    return mods.filter((m) => m.type === type);
  }

  /**
   * Check if a target has a specific modifier key (enabled).
   */
  has(targetId, type, key) {
    return this.getActiveKeys(targetId, type).has(key);
  }

  /**
   * Get all source IDs affecting a target.
   */
  getSources(targetId) {
    const mods = this._byTarget.get(targetId);
    if (!mods) return [];
    return [...new Set(mods.map((m) => m.sourceId))];
  }

  // -----------------------------------------------------------------------
  // These read always-on modifier entries (stat / keyword / ability-augment)
  // and evaluate their filter metadata against passed unit references.
  // -----------------------------------------------------------------------

  /**
   * Public alias for `_matchesUnitFilter` (used by TargetResolver to evaluate
   * a `untargetable_by` blocked-actor filter against a source unit).
   */
  matchesUnitFilter(unit, filter) {
    return this._matchesUnitFilter(unit, filter);
  }

  /**
   * Evaluate a `unitFilter` ({ condition, conditionValue, trait, rank,
   * position, affiliation, attribute, name }) against a unit reference.
   * A missing/empty filter matches everything.
   */
  _matchesUnitFilter(unit, filter) {
    if (!unit || !filter || typeof filter !== "object") return true;

    if (filter.condition) {
      const value = this.getEffective(unit.id, "condition", filter.condition);
      if (filter.conditionValue !== undefined) {
        if (value < filter.conditionValue) return false;
      } else if (value <= 0) {
        return false;
      }
    }
    if (filter.trait && !this.has(unit.id, "trait", filter.trait)) return false;
    if (filter.rank) {
      const ranks = Array.isArray(filter.rank) ? filter.rank : [filter.rank];
      if (!ranks.includes(unit.card?.rank)) return false;
    }
    if (filter.position) {
      const positions = Array.isArray(filter.position) ? filter.position : [filter.position];
      if (!positions.includes(unit.placedPositionCode)) return false;
    }
    if (filter.affiliation) {
      const codes = Array.isArray(filter.affiliation) ? filter.affiliation : [filter.affiliation];
      const unitAffiliations = new Set([
        ...Object.keys(unit.card?.affiliations || {}),
        ...this.getActiveKeys(unit.id, "affiliation"),
      ]);
      if (!codes.some((code) => unitAffiliations.has(code))) return false;
    }
    if (filter.attribute) {
      const codes = Array.isArray(filter.attribute) ? filter.attribute : [filter.attribute];
      if (!codes.some((code) => (unit.card?.attributes || []).includes(code))) return false;
    }
    if (filter.name) {
      if (String(unit.card?.name || "").toLowerCase() !== String(filter.name).toLowerCase()) return false;
    }
    return true;
  }

  /** Enabled `stat` modifiers of one key on a target. */
  _statMods(unitId, key) {
    const mods = this._byTarget.get(unitId);
    if (!mods) return [];
    return mods.filter((m) => m.disabledCount === 0 && m.type === "stat" && m.key === key);
  }

  /**
   * Total damage amplifier applied by `sourceUnit`'s damage-dealing effects
   * against `targetUnit`, honoring the modifier's `when` target filter.
   */
  getDamageDealt(sourceUnit, targetUnit) {
    if (!sourceUnit) return 0;
    return this._statMods(sourceUnit.id, "damage")
      .filter((m) => !m.meta?.when || this._matchesUnitFilter(targetUnit, m.meta.when))
      .reduce((sum, m) => sum + (typeof m.value === "number" ? m.value : 0), 0);
  }

  /**
   * Total heal amplifier applied by `sourceUnit`'s healing effects against
   * `targetUnit`, honoring the modifier's `when` target filter.
   */
  getHealModifier(sourceUnit, targetUnit) {
    if (!sourceUnit) return 0;
    return this._statMods(sourceUnit.id, "heal")
      .filter((m) => !m.meta?.when || this._matchesUnitFilter(targetUnit, m.meta.when))
      .reduce((sum, m) => sum + (typeof m.value === "number" ? m.value : 0), 0);
  }

  /**
   * Total incoming-damage amplifier on `targetUnit` from `sourceUnit`,
   * honoring the modifier's `source` attacker filter (e.g. "Spear bearers
   * deal +4 damage to me").
   */
  getDamageTaken(targetUnit, sourceUnit) {
    if (!targetUnit) return 0;
    return this._statMods(targetUnit.id, "damage_taken")
      .filter((m) => !m.meta?.source || (sourceUnit && this._matchesUnitFilter(sourceUnit, m.meta.source)))
      .reduce((sum, m) => sum + (typeof m.value === "number" ? m.value : 0), 0);
  }

  /**
   * Total amplifier on `sourceUnit`'s application of `condition` to
   * `targetUnit` (e.g. "i give Poisoned +2 to High Ranker units").
   */
  getConditionAmplifier(sourceUnit, targetUnit, condition) {
    if (!sourceUnit) return 0;
    const mods = this._byTarget.get(sourceUnit.id);
    if (!mods) return 0;
    return mods
      .filter((m) => m.disabledCount === 0 && m.type === "stat" && m.key === "condition" && m.meta?.condition === condition)
      .filter((m) => !m.meta?.victimFilter || this._matchesUnitFilter(targetUnit, m.meta.victimFilter))
      .reduce((sum, m) => sum + (typeof m.value === "number" ? m.value : 0), 0);
  }

  /**
   * Number of extra ability resolutions `unit`'s abilities trigger
   * (`modify_repeat`, e.g. Phobos "the bearer's abilities trigger twice").
   */
  getRepeat(unit) {
    if (!unit) return 0;
    return this._statMods(unit.id, "repeat")
      .reduce((sum, m) => sum + (typeof m.value === "number" ? m.value : 0), 0);
  }

  /**
   * The set of keyword overrides (quick / free / ignore_taunt /
   * untargetable_by / retain_equipment) on `unit`. `first`-scoped keywords
   * are included only when `isFirstThisRound` is true (e.g. "the first
   * ability i use each round has Free").
   */
  getKeywords(unit, isFirstThisRound = true) {
    const keys = new Set();
    if (!unit) return keys;
    const mods = this._byTarget.get(unit.id);
    if (!mods) return keys;
    for (const m of mods) {
      if (m.disabledCount !== 0 || m.type !== "keyword") continue;
      if (m.meta?.first && !isFirstThisRound) continue;
      keys.add(m.key);
    }
    return keys;
  }

  /**
   * Targeting rules on `unit`: `{ ignoreTaunt, untargetableBy }` where
   * `untargetableBy` is the blocked-actor filter (or null).
   */
  getTargetingRules(unit) {
    const rules = { ignoreTaunt: false, untargetableBy: null };
    if (!unit) return rules;
    const mods = this._byTarget.get(unit.id);
    if (!mods) return rules;
    for (const m of mods) {
      if (m.disabledCount !== 0 || m.type !== "keyword") continue;
      if (m.key === "ignore_taunt") rules.ignoreTaunt = true;
      if (m.key === "untargetable_by") rules.untargetableBy = m.meta?.blockedFilter || {};
    }
    return rules;
  }

  /**
   * Whether `unit` retains its equipment when returned to hand.
   */
  hasRetainEquipment(unit) {
    if (!unit) return false;
    return this.getKeywords(unit, true).has("retain_equipment");
  }

  /**
   * Augmenting effects (`modify_ability`) attached to `unit`, as
   * `{ effect, sourceId, sourceType }` tuples. Resolved against an ability's
   * enemy targets when the unit uses an ability.
   */
  getAbilityAugments(unit) {
    if (!unit) return [];
    const mods = this._byTarget.get(unit.id);
    if (!mods) return [];
    return mods
      .filter((m) => m.disabledCount === 0 && m.type === "ability-augment" && m.meta?.effect)
      .map((m) => ({ effect: m.meta.effect, sourceId: m.sourceId, sourceType: m.sourceType }));
  }

  /**
   * Clear all modifiers. Primarily for testing.
   */
  clear() {
    this._byId.clear();
    this._byTarget.clear();
    this._bySource.clear();
  }

  /**
   * Deterministic full serialization of every modifier in the stack.
   * Sorted by modifier id so identical stacks produce identical output.
   *
   * @returns {Array<object>}
   */
  toSerializedState() {
    const mods = [...this._byId.values()].map((m) => ({
      id: m.id,
      sourceId: m.sourceId,
      sourceType: m.sourceType,
      targetId: m.targetId,
      type: m.type,
      key: m.key,
      value: m.value,
      operation: m.operation,
      disabledCount: m.disabledCount,
      priority: m.priority,
      expiresAt: m.expiresAt,
      meta: m.meta ?? null,
    }));
    mods.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return mods;
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** @private */
  _removeOne(mod) {
    // Remove from byId
    this._byId.delete(mod.id);

    // Remove from byTarget
    const tList = this._byTarget.get(mod.targetId);
    if (tList) {
      const idx = tList.indexOf(mod);
      if (idx !== -1) tList.splice(idx, 1);
      if (tList.length === 0) this._byTarget.delete(mod.targetId);
    }

    // Remove from bySource
    const sList = this._bySource.get(mod.sourceId);
    if (sList) {
      const idx = sList.indexOf(mod);
      if (idx !== -1) sList.splice(idx, 1);
      if (sList.length === 0) this._bySource.delete(mod.sourceId);
    }

    // Emit revocation event
    this._bus.emit(EVT.MODIFIER_REVOKED(mod.type), {
      modifier: mod,
      targetId: mod.targetId,
      key: mod.key,
      value: mod.value,
    });

    // Notify cross-system cleanup callback (e.g. AbilityRegistry)
    if (this._onRevoke) this._onRevoke(mod);
  }
}
