/**
 * Damage-threshold check for `deal_damage` triggers.
 *
 * A trigger may carry an `amount` threshold ("deals 7+ damage to a single
 * target"). The threshold reads the hit's full post-modifier amount
 * (`payload.hitAmount`, set by DealDamageHandler before the target's
 * remaining HP clamps it), so overkill counts. `payload.amount` — the damage
 * actually applied — is the fallback for events emitted without `hitAmount`.
 *
 * @param {object} trigger — trigger object with optional `amount`
 * @param {object} payload — the `unit:damage:applied` event payload
 * @returns {boolean}
 */
export function meetsDamageThreshold(trigger, payload) {
  if (!trigger?.amount) return true;
  const hit = payload?.hitAmount ?? payload?.amount ?? 0;
  return hit >= trigger.amount;
}
