/**
 * Shared card-definition lookup helpers.
 *
 * `cards` is the keyed compiled card object (`server/data/cards.json`) —
 * `{ "0": {...}, "1": {...} }` — the single source of truth shared by the
 * runtime engine and the attribute engines.
 *
 * A "series" is an explicit, schema-validated card-level field that groups
 * related cards (e.g. "Incinerate I" … "Incinerate IV", "First Thorn Fragment"
 * … "Fourth Thorn Fragment"). It is a first-class data contract, not a name
 * convention — never inferred from display names. These helpers resolve an
 * exact name or an exact series code against the catalog.
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
 * Find all cards whose `series` code exactly matches `series` (case-insensitive),
 * optionally filtered to a card `type`.
 *
 * A series is authored explicitly on each card; there is no name-based
 * inference. This returns every card carrying the matching series code.
 *
 * @param {object} cards keyed compiled card object
 * @param {string} series
 * @param {string} [type]
 * @returns {Array<object>}
 */
export function findCardsBySeries(cards, series, type) {
  if (!cards || typeof cards !== "object") return [];
  const expected = String(series).toLowerCase();
  return Object.values(cards).filter(
    (card) =>
      card &&
      card.series?.toLowerCase() === expected &&
      (type === undefined || card.type === type)
  );
}

/**
 * Find all cards carrying a keyword whose `code` exactly matches `keywordCode`
 * (case-insensitive), optionally filtered to a card `type`.
 *
 * Keywords are identity markers authored on each card; the compiler normalizes
 * them to a uniform `{ code, raw? }` object. Unlike `series`, a keyword is not
 * a first-class grouping field, so this helper inspects the `keywords` array
 * directly. The three Jeonsul Baangs carry `jeonsul-baang` as a keyword code
 * rather than a `series`, so `findCardsBySeries` returns nothing for them.
 *
 * @param {object} cards keyed compiled card object
 * @param {string} keywordCode
 * @param {string} [type]
 * @returns {Array<object>}
 */
export function findCardsByKeyword(cards, keywordCode, type) {
  if (!cards || typeof cards !== "object") return [];
  const expected = String(keywordCode).toLowerCase();
  return Object.values(cards).filter(
    (card) =>
      card &&
      Array.isArray(card.keywords) &&
      card.keywords.some((k) => k?.code?.toLowerCase() === expected) &&
      (type === undefined || card.type === type)
  );
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
 * @returns {{ id: string, cardId: number, name: string, series: string|null,
 *             type: string, cost: number, rank: string|null, positions: string[],
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
    series: card.series ?? null,
    type: card.type,
    kind: card.kind ?? "standard",
    line: card.line ?? null,
    cost: card.cost,
    rank: card.rank ?? null,
    positions: toCodes(card.positions),
    affiliations: toCodes(card.affiliations),
    attributes: Array.isArray(card.attributes) ? card.attributes : [],
  };
}

export default { findCardsByName, findCardsBySeries, findCardsByKeyword, toCardTargetView };
