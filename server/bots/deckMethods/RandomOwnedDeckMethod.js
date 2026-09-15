/**
 * The "random-owned" deck method: the bot plays one of the human seat's own
 * saved decks, chosen uniformly with the seat's seeded rng from the decks
 * that are legal under the deck contract.
 *
 * A collection with no legal deck falls back to the generated method, which
 * always produces a legal deck, so a bot seat never fails to field a deck
 * because of what its human owns.
 */

import { validateDeckCards } from "../../decks/deckValidation.js";
import GeneratedDeckMethod from "./GeneratedDeckMethod.js";

export default class RandomOwnedDeckMethod {
  /**
   * Resolve the concrete deck this seat plays.
   *
   * @param {object} context
   * @param {object} context.catalog the compiled card catalog
   * @param {object} context.deckLibrary the deck library (reads the human's own decks)
   * @param {string} context.ownerUsername the human seat that created the room
   * @param {{ next(): number }} context.rng the seat's seeded rng
   * @returns {Promise<{ deckId: string, name: string, cards: string[], illegal: boolean }>}
   */
  async resolve({ catalog, deckLibrary, ownerUsername, rng }) {
    if (!deckLibrary || typeof deckLibrary.listDecks !== "function") {
      throw new TypeError("The random-owned deck method needs a deck library.");
    }

    const decks = await deckLibrary.listDecks(ownerUsername);
    const legal = decks.filter((deck) => validateDeckCards(deck.cards, catalog).legal);
    if (legal.length === 0) {
      return new GeneratedDeckMethod().resolve({ catalog, rng });
    }

    const deck = legal[Math.floor(rng.next() * legal.length)];
    return { deckId: deck.id, name: deck.name, cards: [...deck.cards], illegal: false };
  }
}
