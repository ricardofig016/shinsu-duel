import Card from "../game/Card.js";

const TEST_NAME_PATTERN = /^_test/i;

/**
 * Test cards are the `_Test*` entries authored under `data/cards/test/`; the
 * name prefix is the only marker they carry in the compiled catalog.
 */
export function isTestCard(card) {
  return typeof card?.name === "string" && TEST_NAME_PATTERN.test(card.name);
}

/**
 * Project the compiled catalog into client card views. Views are built
 * through `Card.toSanitizedObject()` — the single client card-view contract —
 * so a browse page consumes exactly the shape the game sends over the wire.
 *
 * @param {object} cards keyed compiled catalog (`server/data/cards.json`)
 * @param {{ includeTest?: boolean }} [options] include the `_Test*` cards
 * @returns {object[]} card views in catalog order
 */
export function buildCatalogViews(cards, { includeTest = false } = {}) {
  const views = [];
  for (const [key, entry] of Object.entries(cards)) {
    if (!includeTest && isTestCard(entry)) continue;
    views.push(new Card(Number(key), entry, null, null).toSanitizedObject());
  }
  return views;
}

/**
 * Artwork files no card view claims: an artwork file is claimed when its
 * name equals the basename of a card view's `artworkPath`. Cards without
 * artwork claim nothing, so missing artwork never hides an orphan.
 *
 * @param {object[]} cardViews client card views
 * @param {string[]} artworkFileNames file names in the artworks directory
 * @returns {string[]} unclaimed file names, in the given order
 */
export function findOrphanArtworks(cardViews, artworkFileNames) {
  const claimed = new Set();
  for (const view of cardViews) {
    if (typeof view?.artworkPath !== "string" || view.artworkPath === "") continue;
    const baseName = view.artworkPath.split(/[\\/]/).pop();
    if (baseName) claimed.add(baseName);
  }
  return artworkFileNames.filter((fileName) => !claimed.has(fileName));
}
