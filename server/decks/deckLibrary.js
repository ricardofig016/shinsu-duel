import crypto from "node:crypto";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "../utils/file-util.js";

/**
 * Deck collection storage — one record per saved deck, keyed by deck id in
 * `server/data/decks.json`.
 *
 * A record is `{ id, owner, name, cards, updatedAt }`, where `cards` holds
 * card **slugs** (the persistent card identifier; the runtime cardId shifts
 * whenever the compiled catalog changes). The library owns record shape and
 * storage only: deck legality lives in `deckValidation.js`, and the routes
 * combine the two. Every read and write is owner-scoped, so a caller cannot
 * reach another user's deck through this API.
 */

export const decksFilePath = path.resolve("server/data/decks.json");

const DECK_ID_SPACE = 36 ** 6;

function generateDeckId(existingDecks) {
  let id;
  do id = crypto.randomInt(0, DECK_ID_SPACE).toString(36).toUpperCase().padStart(6, "0");
  while (existingDecks[id]);
  return id;
}

function assertCardsShape(cards) {
  if (!Array.isArray(cards) || cards.some((slug) => typeof slug !== "string" || slug.length === 0)) {
    throw new Error("Deck cards must be an array of card slugs.");
  }
}

/**
 * @param {{ filePath?: string }} [options]
 */
export function createDeckLibrary({ filePath = decksFilePath } = {}) {
  const readAll = () => readJsonFile(filePath);

  const toRecord = (deck) => ({
    id: deck.id,
    owner: deck.owner,
    name: deck.name,
    cards: [...deck.cards],
    updatedAt: deck.updatedAt,
  });

  return {
    filePath,

    /**
     * Decks owned by `owner`, ordered by name then id for a stable listing.
     */
    async listDecks(owner) {
      const decks = await readAll();
      return Object.values(decks)
        .filter((deck) => deck.owner === owner)
        .map(toRecord)
        .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    },

    /**
     * @returns {Promise<object|null>} the deck, or null when it does not exist
     *   or belongs to another owner.
     */
    async getOwnedDeck(id, owner) {
      const decks = await readAll();
      const deck = decks[id];
      if (!deck || deck.owner !== owner) return null;
      return toRecord(deck);
    },

    /**
     * @param {{ owner: string, name: string, cards: string[] }} deck
     */
    async createDeck({ owner, name, cards }) {
      if (typeof owner !== "string" || owner.length === 0) {
        throw new Error("Deck owner is required.");
      }
      assertCardsShape(cards);
      const decks = await readAll();
      const id = generateDeckId(decks);
      decks[id] = { id, owner, name, cards: [...cards], updatedAt: new Date().toISOString() };
      await writeJsonFile(filePath, decks);
      return toRecord(decks[id]);
    },

    /**
     * @returns {Promise<object|null>} the updated deck, or null when it does
     *   not exist or belongs to another owner.
     */
    async updateDeck(id, owner, { name, cards }) {
      assertCardsShape(cards);
      const decks = await readAll();
      const deck = decks[id];
      if (!deck || deck.owner !== owner) return null;
      deck.name = name;
      deck.cards = [...cards];
      deck.updatedAt = new Date().toISOString();
      await writeJsonFile(filePath, decks);
      return toRecord(deck);
    },

    /**
     * @returns {Promise<boolean>} whether a deck was removed.
     */
    async deleteDeck(id, owner) {
      const decks = await readAll();
      const deck = decks[id];
      if (!deck || deck.owner !== owner) return false;
      delete decks[id];
      await writeJsonFile(filePath, decks);
      return true;
    },
  };
}

export default createDeckLibrary();
