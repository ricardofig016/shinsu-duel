/**
 * Canonical rank catalog per RULES.md §Rank: each rank's display name and the
 * shinsu-cost range a card of that rank may have. Single source shared by the
 * card validator (build-time enforcement) and the glossary route (display),
 * so the displayed ranges can never drift from the enforced ones.
 */
export const RANKS = Object.freeze({
  regular: Object.freeze({ name: "Regular", minCost: 0, maxCost: 5 }),
  ranker: Object.freeze({ name: "Ranker", minCost: 3, maxCost: 7 }),
  "high ranker": Object.freeze({ name: "High Ranker", minCost: 5, maxCost: 10 }),
});
