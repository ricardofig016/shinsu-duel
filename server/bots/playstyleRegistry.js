/**
 * Registry of bot playstyles keyed by kebab-case id.
 *
 * A playstyle is the behavioral half of a bot: it turns the seat's own
 * redacted view into a turn action or a decision resolution, sampling with
 * the seeded rng it is handed. Playstyles are stateless, so one instance
 * serves every seat; the per-session rng lives in the controller that owns
 * the seat.
 */

import WhateverPlaystyle from "./playstyles/WhateverPlaystyle.js";
import DrunkPlaystyle from "./playstyles/DrunkPlaystyle.js";

export function createPlaystyleRegistry() {
  const playstyles = new Map([
    ["whatever", new WhateverPlaystyle()],
    ["drunk", new DrunkPlaystyle()],
  ]);

  return {
    /**
     * @param {string} id a playstyle id
     * @returns {object} the playstyle, exposing `decideTurn(view, rng)` and `resolveDecision(decision, rng)`
     */
    get(id) {
      const playstyle = playstyles.get(id);
      if (!playstyle) throw new Error(`Unknown bot playstyle: "${id}"`);
      return playstyle;
    },

    /** @param {string} id */
    has(id) {
      return playstyles.has(id);
    },

    /** @returns {string[]} */
    names() {
      return [...playstyles.keys()];
    },
  };
}
