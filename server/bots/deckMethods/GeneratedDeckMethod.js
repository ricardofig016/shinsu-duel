/**
 * The "generated" deck method: build a fresh legal deck from the compiled
 * catalog.
 *
 * The draw comes from the deck-legal slug pool (no Unreachable cards, no
 * test cards, each card up to `MAX_CARD_COPIES`) through the shared seeded
 * Fisher–Yates shuffle, so the deck is legal by construction and
 * deterministic per seed. The result is asserted legal before it is
 * returned, so a contract drift surfaces instead of reaching a game.
 */

import GameState from "../../game/GameState.js";
import shuffle from "../../game/utils/shuffle.js";
import { buildLegalSlugPool, validateDeckCards } from "../../decks/deckValidation.js";

export const GENERATED_DECK_ID = "bot-generated";
export const GENERATED_DECK_NAME = "Randomly Generated";

export default class GeneratedDeckMethod {
  /**
   * Resolve the concrete deck this seat plays.
   *
   * @param {object} context
   * @param {object} context.catalog the compiled card catalog
   * @param {{ next(): number }} context.rng the seat's seeded rng
   * @returns {Promise<{ deckId: string, name: string, cards: string[], illegal: boolean }>}
   */
  async resolve({ catalog, rng }) {
    if (!rng || typeof rng.next !== "function") {
      throw new TypeError("The generated deck method needs a seeded rng.");
    }

    const pool = buildLegalSlugPool(catalog);
    if (pool.length < GameState.INIT_DECK_SIZE) {
      throw new Error("The catalog cannot fill a legal deck.");
    }

    const cards = shuffle([...pool], rng).slice(0, GameState.INIT_DECK_SIZE);
    const validation = validateDeckCards(cards, catalog);
    if (!validation.legal) {
      throw new Error(`Generated bot deck is not legal: ${validation.problems.join(" ")}`);
    }

    return { deckId: GENERATED_DECK_ID, name: GENERATED_DECK_NAME, cards, illegal: false };
  }
}
