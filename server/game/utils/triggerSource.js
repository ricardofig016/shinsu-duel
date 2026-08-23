/**
 * Match a `trigger.source` value against a unit — by kind first, then name.
 *
 * `trigger.source` is a plain authored string that may name a card
 * (`monkeyman`) or an archetype kind (`shinheuh`). Kind is structural and
 * preferred; the name fallback preserves the card-name convention used by
 * transformation triggers ("when damaged by Monkeyman").
 *
 * @param {object|null} unit — the source unit to test
 * @param {string} [source] — the authored source value; absent means "any"
 * @returns {boolean}
 */
export function matchesTriggerSource(unit, source) {
  if (!source) return true;
  const expected = String(source).trim().toLowerCase();
  const card = unit?.card;
  if (!card) return false;
  if (card.kind && card.kind === expected) return true;
  return String(card.name || "").toLowerCase() === expected;
}
