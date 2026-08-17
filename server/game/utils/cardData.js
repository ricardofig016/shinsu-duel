/**
 * Shared card-definition lookup helpers.
 *
 * `cards` is the keyed compiled card object (`server/data/cards.json`) —
 * `{ "0": {...}, "1": {...} }` — the single source of truth shared by the
 * runtime engine and the attribute engines.
 *
 * A "family" is a group of cards whose names share a common prefix and differ
 * by a trailing Roman-numeral (e.g. "Incinerate I" … "Incinerate IV"). These
 * helpers let handlers resolve both an exact name and a family by the same
 * data-driven rules, avoiding duplicated name-matching logic.
 */

/**
 * Find all cards whose name exactly matches `name` (case-insensitive),
 * optionally filtered to a card `type` (unit | skill | equipment).
 *
 * @param {object} cards keyed compiled card object
 * @param {string} name
 * @param {string} [type]
 * @returns {Array<object>}
 */
export function findCardsByName(cards, name, type) {
  if (!cards || typeof cards !== "object") return [];
  const expected = String(name).toLowerCase();
  return Object.values(cards).filter(
    (card) =>
      card &&
      card.name?.toLowerCase() === expected &&
      (type === undefined || card.type === type)
  );
}

/**
 * Find all cards whose name starts with `name` (case-insensitive) as a
 * distinct token, optionally filtered to a card `type`.
 *
 * A family match requires the candidate name to begin with the family name
 * followed by a non-word character (space, hyphen, digit), so "Baang" does
 * not match "Baangsomething" but does match "Baang". A card whose name equals
 * the family name itself is included (and will normally be returned first).
 *
 * @param {object} cards keyed compiled card object
 * @param {string} name
 * @param {string} [type]
 * @returns {Array<object>}
 */
export function findCardsByFamily(cards, name, type) {
  if (!cards || typeof cards !== "object") return [];
  const prefix = String(name).toLowerCase();
  return Object.values(cards)
    .filter(
      (card) =>
        card &&
        card.name?.toLowerCase().startsWith(prefix) &&
        (type === undefined || card.type === type)
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

export default { findCardsByName, findCardsByFamily };
