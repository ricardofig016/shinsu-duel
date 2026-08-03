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
 *     enabled:   boolean (Silence flips to false)
 *   }
 */

let _idCounter = 0;
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
    this._bus.on("unit:destroyed", (payload) => {
      this.removeByTarget(payload.unitId);
    }, { phase: "post" });
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
      enabled: true,
      createdAt: this._clock.now(),
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
   * Disable all modifiers of the given type(s) on a target.
   * Used by Silence to suppress traits without deleting them.
   */
  disableByTarget(targetId, types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const mods = this._byTarget.get(targetId);
    if (!mods) return;

    for (const mod of mods) {
      if (typeSet.has(mod.type)) {
        mod.enabled = false;
      }
    }
    this._bus.emit("modifier:disabled", { targetId, types: [...typeSet] });
  }

  /**
   * Re-enable all modifiers of the given type(s) on a target.
   * Used when Silence ends.
   */
  enableByTarget(targetId, types) {
    const typeSet = new Set(Array.isArray(types) ? types : [types]);
    const mods = this._byTarget.get(targetId);
    if (!mods) return;

    for (const mod of mods) {
      if (typeSet.has(mod.type)) {
        mod.enabled = true;
      }
    }
    this._bus.emit("modifier:enabled", { targetId, types: [...typeSet] });
  }

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  /**
   * Get the effective (net) value for a target's modifier type/key.
   * Only `enabled` modifiers with `operation === "add"` are summed.
   */
  getEffective(targetId, type, key) {
    const mods = this._byTarget.get(targetId);
    if (!mods) return 0;

    let total = 0;
    for (const mod of mods) {
      if (!mod.enabled || mod.type !== type || mod.key !== key) continue;

      if (mod.operation === "set" || mod.operation === "override") {
        return mod.value;
      }

      if (mod.operation === "add") {
        total += (typeof mod.value === "number" ? mod.value : 0);
      }
    }
    return total;
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
      if (mod.enabled && mod.type === type) {
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
  }
}
