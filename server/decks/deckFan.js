import { buildSlugIndex } from "../utils/card-catalog.js";

/**
 * A deck's fan, computed from stored slugs: up to three distinct units, the
 * most expensive ones, in display order (cheapest first, most expensive last).
 * Slugs missing from the catalog and non-unit cards never appear.
 *
 * The pre-game versus reveal carries only the fan slugs, never a deck's full
 * card list, so the server picks the fan itself. The rule is the one the
 * client's shared deck table uses for the fan it draws on a list row, and
 * `deckFan.test.js` pins the two implementations to the same answer.
 */

const FAN_LIMIT = 3;
const nameCollator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

/**
 * @param {string[]} cardSlugs the deck's stored card slugs
 * @param {object} catalog compiled card catalog keyed by card id
 * @param {{ limit?: number }} [options]
 * @returns {string[]} fan slugs, cheapest first
 */
export function buildDeckFanSlugs(cardSlugs, catalog, { limit = FAN_LIMIT } = {}) {
  const bySlug = buildSlugIndex(catalog);
  const units = [...new Set(cardSlugs ?? [])]
    .map((slug) => bySlug.get(slug) ?? null)
    .filter((entry) => entry && entry.type === "unit");

  units.sort(
    (a, b) =>
      (b.cost ?? 0) - (a.cost ?? 0) ||
      nameCollator.compare(a.name ?? "", b.name ?? "") ||
      (a.slug ?? "").localeCompare(b.slug ?? "")
  );

  return units.slice(0, limit).reverse().map((entry) => entry.slug);
}
