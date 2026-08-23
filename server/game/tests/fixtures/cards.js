/**
 * Stable, test-owned card catalog (compiled artifact).
 *
 * These cards are the ONLY card definitions unit/integration tests resolve
 * against. They are deliberately independent of `server/data/cards.json` and
 * the `data/cards/**` YAML sources, so balance patches and card-content edits
 * never break implementation tests.
 *
 * Authoring workflow:
 *   Fixtures are authored as YAML in `fixtures/yaml/**` using the **same
 *   source shape as `data/cards`** (display names for positions/attributes/
 *   affiliations, string traits, raw `evolve`/`ignition` strings). Run
 *   `npm run compile:fixtures` to normalize + schema-validate them and
 *   regenerate `fixtures/cards.json` (this file). Never hand-edit the
 *   compiled shape - `scripts/compile-fixtures.js` is the single path from
 *   YAML source to this artifact.
 *
 * Conventions (enforced by `FixtureCardAudit.test.js`):
 *   - Named fixtures use compiler-assigned ids 10000+ with a `Test` prefix
 *     (never authored); generic fillers use ids 1..40 and MUST keep the
 *     lowest ids so `createLegalDeck` slices them first (JS integer-like
 *     object keys sort numerically).
 *   - `Fire Core` keeps its exact name (`HwayeomsaEngine` hardcodes it);
 *     `series: "incinerate"` / `"thorn-fragment"` are kept so engines resolve
 *     them structurally.
 */

import compiledCards from "./cards.json" with { type: "json" };

/** Keyed catalog `{ [cardId]: card }`, mirroring the compiled contract. */
export const cards = compiledCards;

/** Name (lowercased) -> cardId lookup. */
export const byName = Object.fromEntries(
  Object.values(cards).map((card) => [card.name.toLowerCase(), card.cardId])
);

export default { cards, byName };
