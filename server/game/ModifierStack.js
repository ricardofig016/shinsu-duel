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
    };

    this._byId.set(mod.id, mod);

    // Index by target
    if (!this._byTarget.has(mod.targetId)) this._byTarget.set(mod.targetId, []);
    this._byTarget.get(mod.targetId).push(mod);

    // Index by source
    if (!this._bySource.has(mod.sourceId)) this._bySource.set(mod.sourceId, []);
    this._bySource.get(mod.sourceId).push(mod);

    // Emit event
    this._bus.emit(`modifier:${mod.type}:granted`, {
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

  // ── Priority-based getEffective (Phase 2) ──────────────────────────────
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
    this._bus.emit(`modifier:${mod.type}:revoked`, {
      modifier: mod,
      targetId: mod.targetId,
      key: mod.key,
      value: mod.value,
    });

    // Notify cross-system cleanup callback (e.g. AbilityRegistry)
    if (this._onRevoke) this._onRevoke(mod);
  }
}
