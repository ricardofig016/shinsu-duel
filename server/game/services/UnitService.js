/**
 * Authoritative unit combat-state service.
 *
 * Owns a unit's `currentHp` — the single place where HP is read and written.
 * Handlers and engines delegate damage, healing, and HP restoration here
 * instead of mutating `unit.currentHp` directly, so clamping and caps are
 * applied consistently across every path.
 *
 * This service is pure math: it emits no events. Callers emit the
 * `unit:damage:applied` / `unit:heal:applied` events through their EventBus
 * context after the mutation, mirroring the SpendShinsu/Compress split.
 */

export default class UnitService {
  /**
   * Apply damage to a unit, clamped to its remaining HP.
   *
   * @param {object} unit — has `currentHp`
   * @param {number} amount — non-negative damage
   * @returns {{ applied: number, currentHp: number }}
   */
  static damage(unit, amount) {
    const damage = Math.max(0, Number(amount) || 0);
    const applied = Math.min(damage, unit.currentHp);
    unit.currentHp -= applied;
    return { applied, currentHp: unit.currentHp };
  }

  /**
   * Heal a unit, capped at its maximum HP.
   *
   * @param {object} unit — has `currentHp` and `card.maxHp`
   * @param {number} amount — non-negative healing
   * @returns {{ healed: number, currentHp: number }}
   */
  static heal(unit, amount) {
    const heal = Math.max(0, Number(amount) || 0);
    const maxHp = unit.card?.maxHp ?? 0;
    const healed = Math.min(heal, maxHp - unit.currentHp);
    unit.currentHp += healed;
    return { healed, currentHp: unit.currentHp };
  }

  /**
   * Set a unit's HP to an absolute value, floored at 0.
   *
   * @param {object} unit — has `currentHp`
   * @param {number} value
   * @returns {number} The resulting HP.
   */
  static setHp(unit, value) {
    unit.currentHp = Math.max(0, Number(value) || 0);
    return unit.currentHp;
  }

  /**
   * Permanently raise a unit's maximum and current HP by `amount`.
   *
   * Both `unit.card.maxHp` and `unit.currentHp` rise by the same amount, so
   * the lost-HP delta is preserved. This is the authoritative boundary for
   * permanent HP grants: unlike `ModifierService._applyHp`, which records a
   * reversible stat modifier for equipment auras, it records no modifier and
   * is not reversible. `UnitService` owns `currentHp`; this extends that
   * ownership to permanent `maxHp` grants.
   *
   * @param {object} unit — has `currentHp` and `card.maxHp`
   * @param {number} amount — non-negative HP to grant
   * @returns {{ granted: number, currentHp: number, maxHp: number }}
   */
  static grantHp(unit, amount) {
    const grant = Math.max(0, Number(amount) || 0);
    unit.card.maxHp += grant;
    unit.currentHp += grant;
    return { granted: grant, currentHp: unit.currentHp, maxHp: unit.card.maxHp };
  }
}
