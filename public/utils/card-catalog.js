/**
 * Client-side access to the compiled card catalog's client views.
 *
 * `GET /cards/data` serves every public card as a `Card.toSanitizedObject()`
 * view — the same shape the game wire carries — including the compiler's
 * `relatedCards` stamp. The index supports the three lookup keys the card
 * detail surfaces need: the runtime `cardId` (relation entries), the
 * persistent `slug` (the deck collection's identifier), and the card `name`
 * (the wire's equipment-attachment entries are name-only). The runtime
 * cardId is a name-sorted compile-time index that shifts when the catalog
 * changes, so nothing outside the compiled artifact may store it (see
 * docs/DECK_COLLECTION.md).
 */

/**
 * Build lookup maps over card views. First entry wins per key; duplicates
 * are catalog defects the compile already rejects.
 *
 * @param {Array<object>} cardViews - client card views from `GET /cards/data`
 * @returns {{ byId: Map<number, object>, bySlug: Map<string, object>, byName: Map<string, object> }}
 */
export function buildCatalogIndex(cardViews) {
  const byId = new Map();
  const bySlug = new Map();
  const byName = new Map();
  for (const view of cardViews ?? []) {
    if (!view || typeof view !== "object") continue;
    if (Number.isInteger(view.cardId) && !byId.has(view.cardId)) byId.set(view.cardId, view);
    if (typeof view.slug === "string" && view.slug !== "" && !bySlug.has(view.slug)) bySlug.set(view.slug, view);
    if (typeof view.name === "string" && view.name !== "" && !byName.has(view.name.toLowerCase())) {
      byName.set(view.name.toLowerCase(), view);
    }
  }
  return { byId, bySlug, byName };
}

/**
 * Fetch the card catalog's public views and resolve them into the lookup
 * index. One request per call — pages that want a single shared fetch use
 * `getCardCatalog`, whose page-level cache holds the promise.
 *
 * @returns {Promise<{ byId: Map<number, object>, bySlug: Map<string, object>, byName: Map<string, object> }>}
 */
export async function fetchCardCatalog() {
  const response = await fetch("/cards/data/");
  if (!response.ok) throw new Error(`GET /cards/data/ failed: ${response.status}`);
  const payload = await response.json();
  return buildCatalogIndex(payload.cards ?? []);
}

let catalogPromise = null;

/**
 * The page-level catalog cache: the first caller fetches, every later one
 * shares the same promise (a failure is cached too, so callers see one
 * consistent outcome instead of refetching) — the same contract as
 * `getGlossary`. Callers decide how to degrade when the catalog is
 * unavailable.
 *
 * @returns {Promise<{ byId: Map<number, object>, bySlug: Map<string, object>, byName: Map<string, object> }>}
 */
export const getCardCatalog = () => {
  if (!catalogPromise) catalogPromise = fetchCardCatalog();
  return catalogPromise;
};
