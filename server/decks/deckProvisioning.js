import deckLibrary from "./deckLibrary.js";
import { loadStarterDecks } from "./starterDecks.js";

/**
 * Copy the starter decks into a new account's collection. Runs once, at
 * account creation: there is no lazy or legacy provisioning, so a user that
 * deletes every deck keeps an empty collection.
 *
 * The copies are ordinary decks owned by the user. A failure part-way through
 * removes the copies already created, so a retry never leaves duplicates.
 *
 * @param {string} username
 * @param {{ library?: object, decks?: object[] }} [options]
 * @returns {Promise<object[]>} the created deck records
 */
export async function provisionStarterDecks(username, { library = deckLibrary, decks } = {}) {
  const templates = decks ?? (await loadStarterDecks());
  const created = [];
  try {
    for (const template of templates) {
      created.push(await library.createDeck({ owner: username, name: template.name, cards: template.cards }));
    }
  } catch (error) {
    for (const deck of created) await library.deleteDeck(deck.id, username);
    throw error;
  }
  return created;
}
