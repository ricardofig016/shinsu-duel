/**
 * Registry of bot deck methods keyed by kebab-case id.
 *
 * A deck method is the deck half of a bot: given a resolution context (the
 * compiled catalog, the deck library, the human seat's re-read deck, and the
 * seat's seeded rng), it produces the concrete pick a bot seat fields.
 * Methods are stateless, so one instance serves every seat.
 */

import MirrorDeckMethod from "./deckMethods/MirrorDeckMethod.js";
import RandomOwnedDeckMethod from "./deckMethods/RandomOwnedDeckMethod.js";
import GeneratedDeckMethod from "./deckMethods/GeneratedDeckMethod.js";

export function createDeckMethodRegistry() {
  const methods = new Map([
    ["mirror", new MirrorDeckMethod()],
    ["random-owned", new RandomOwnedDeckMethod()],
    ["generated", new GeneratedDeckMethod()],
  ]);

  return {
    /**
     * @param {string} id a deck-method id
     * @returns {object} the method, exposing `resolve(context)`
     */
    get(id) {
      const method = methods.get(id);
      if (!method) throw new Error(`Unknown bot deck method: "${id}"`);
      return method;
    },

    /** @param {string} id */
    has(id) {
      return methods.has(id);
    },

    /** @returns {string[]} */
    names() {
      return [...methods.keys()];
    },
  };
}
