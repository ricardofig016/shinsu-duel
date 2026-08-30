/**
 * Canonical card slug: the lowercase snake_case derivation shared by every
 * consumer that needs a stable, human-readable card identifier.
 *
 * Consumers:
 * - card-validate.js enforces that each card's YAML file is named
 *   `<slug>.yml`, making the slug the enforced on-disk identity.
 * - card-create.js scaffolds new card files with the same rule.
 * - card-compile.js matches card artwork files named `<slug>.png`.
 *
 * "Ha Yuri Zahard" → "ha_yuri_zahard"
 *
 * @param {string} rawName - card display name, e.g. "Twenty-Fifth Baam"
 * @returns {string} slug, e.g. "twenty_fifth_baam"
 */
export function normalizeName(rawName) {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}
