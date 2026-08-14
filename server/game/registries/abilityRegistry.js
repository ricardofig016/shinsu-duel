import * as IdFactory from "../IdFactory.js";
import EVT from "../EventCatalog.js";

/**
 * Pluggable ability registry for runtime-granted abilities.
 *
 * Tracks abilities granted to units by external sources (equipment,
 * skills, passives). Each granted ability has a unique code and is
 * cleaned up automatically when its source is removed.
 *
 * Unlike the ModifierStack approach, this registry stores abilities as
 * structured DSL objects, not serialized JSON strings.
 */
export default class AbilityRegistry {
  constructor() {
    /** @type {Map<string, Array<{code: string, ability: object, sourceId: string, sourceType: string}>>} */
    this._abilities = new Map();
  }

  /**
   * Grant an ability DSL to a unit. The ability is NOT executed —
   * it becomes a usable action on the target unit.
   *
   * @param {string} targetId — unit receiving the ability
   * @param {string} sourceId — provenance (e.g. equipment card instance id)
   * @param {string} sourceType — "equipment", "skill", "passive"
   * @param {object} ability — compiled DSL object
   * @returns {{ code: string, ability: object }}
   */
  grant(targetId, sourceId, sourceType, ability) {
    if (!targetId || !sourceId || !ability) {
      throw new Error("AbilityRegistry.grant: targetId, sourceId, and ability are required");
    }

    const code = IdFactory.grantedAbilityCode(sourceId, ability);

    if (!this._abilities.has(targetId)) {
      this._abilities.set(targetId, []);
    }

    this._abilities.get(targetId).push({ code, ability, sourceId, sourceType });
    return { code, ability };
  }

  /**
   * Revoke all abilities from a specific source on a target.
   *
   * @param {string} targetId
   * @param {string} sourceId
   * @returns {Array<object>} removed abilities
   */
  revokeBySource(targetId, sourceId) {
    const abilities = this._abilities.get(targetId);
    if (!abilities) return [];

    const removed = [];
    const remaining = [];
    for (const entry of abilities) {
      if (entry.sourceId === sourceId) {
        removed.push(entry);
      } else {
        remaining.push(entry);
      }
    }

    if (remaining.length > 0) {
      this._abilities.set(targetId, remaining);
    } else {
      this._abilities.delete(targetId);
    }

    return removed;
  }

  /**
   * Revoke all granted abilities on a target (e.g., unit destroyed).
   */
  revokeAll(targetId) {
    const removed = this._abilities.get(targetId) || [];
    this._abilities.delete(targetId);
    return removed;
  }

  /**
   * Get all granted abilities for a unit.
   *
   * @returns {Array<{code: string, ability: object, sourceId: string, sourceType: string}>}
   */
  getGranted(targetId) {
    return this._abilities.get(targetId) || [];
  }

  /**
   * Resolve a granted ability code back to its DSL object and provenance.
   *
   * @param {string} targetId
   * @param {string} abilityCode — e.g. "granted:Equip#17:deal_damage"
   * @returns {{ ability: object, sourceType: string, sourceId: string } | null}
   */
  resolve(targetId, abilityCode) {
    const abilities = this._abilities.get(targetId);
    if (!abilities) return null;
    const entry = abilities.find((a) => a.code === abilityCode);
    if (!entry) return null;
    return { ability: entry.ability, sourceType: entry.sourceType, sourceId: entry.sourceId };
  }

  /**
   * Deterministic full serialization of all granted abilities.
   * Sorted by targetId (and entry code) for reproducible output.
   *
   * @returns {Array<{ targetId: string, entries: Array<object> }>}
   */
  toSerializedState() {
    const targets = [...this._abilities.keys()].sort();
    return targets.map((targetId) => ({
      targetId,
      entries: this._abilities
        .get(targetId)
        .map((entry) => ({
          code: entry.code,
          ability: entry.ability,
          sourceId: entry.sourceId,
          sourceType: entry.sourceType,
        }))
        .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)),
    }));
  }
}
