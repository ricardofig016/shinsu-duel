/**
 * Shared card-definition lookup helpers.
 *
 * `cards` is the keyed compiled card object (`server/data/cards.json`) —
 * `{ "0": {...}, "1": {...} }` — the single source of truth shared by the
 * runtime engine and the attribute engines.
 *
 * A "family" is a group of cards whose names share a common base name and
 * differ by a numeral or ordinal — e.g. "Incinerate I" … "Incinerate IV"
 * (trailing Roman-numeral) or "First Thorn Fragment" … "Fourth Thorn Fragment"
 * (leading ordinal). These helpers let handlers resolve both an exact name and
 * a family by the same data-driven rules, avoiding duplicated name-matching
 * logic.
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
 * Find all cards whose name contains `name` (case-insensitive) as a base
 * name, optionally filtered to a card `type`.
 *
 * A family match includes any card whose name embeds the family base name as a
 * contiguous token sequence, so it handles both trailing numerals
 * ("Incinerate I" … "Incinerate IV") and leading ordinals ("First Thorn
 * Fragment" … "Fourth Thorn Fragment"). Exact-name matches are resolved first
 * by `findCardsByName`; this is the fallback for multi-card families.
 *
 * @param {object} cards keyed compiled card object
 * @param {string} name
 * @param {string} [type]
 * @returns {Array<object>}
 */
export function findCardsByFamily(cards, name, type) {
  if (!cards || typeof cards !== "object") return [];
  const family = String(name).toLowerCase();
  return Object.values(cards)
    .filter(
      (card) =>
        card &&
        card.name?.toLowerCase().includes(family) &&
        (type === undefined || card.type === type)
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * Normalize a card (a runtime `Card` instance or a compiled `cards.json`
 * entry) into a uniform filter view for card-target resolution.
 *
 * `Card` instances store `positions`/`affiliations` as code→entry dictionaries
 * while compiled catalog entries store plain code arrays. This helper collapses
 * both to string arrays so card-target filters have a single representation.
 *
 * @param {object} card a Card instance or a compiled card definition
 * @returns {{ id: string, cardId: number, name: string, type: string,
 *             cost: number, rank: string|null, positions: string[],
 *             affiliations: string[], attributes: string[] } | null}
 */
export function toCardTargetView(card) {
  if (!card || typeof card !== "object") return null;

  const toCodes = (value) => {
    if (Array.isArray(value)) {
      return value.map((item) => (typeof item === "string" ? item : item?.code)).filter(Boolean);
    }
    if (value && typeof value === "object") return Object.keys(value);
    return [];
  };

  return {
    id: card.id ?? String(card.cardId),
    cardId: card.cardId,
    name: card.name,
    type: card.type,
    cost: card.cost,
    rank: card.rank ?? null,
    positions: toCodes(card.positions),
    affiliations: toCodes(card.affiliations),
    attributes: Array.isArray(card.attributes) ? card.attributes : [],
  };
}

export default { findCardsByName, findCardsByFamily, toCardTargetView };
