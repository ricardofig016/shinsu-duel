/**
 * The client mirror of the server's bot roster (see `server/bots/botCatalog.js`)
 * and deck methods (see `server/bots/deckMethodRegistry.js`), the same way
 * `devRooms.js` mirrors the server's dev-room check. The server remains the
 * authority: `createRoom` refuses an unknown bot or deck method.
 */

export const BOTS = [
  { id: "whatever", name: "Whatever", blurb: "Could not care less. Passes. Every turn. Forever." },
  { id: "drunk", name: "Drunk", blurb: "Plays whatever the shinsu spirits whisper. Card? Slot? Who knows." },
];

export const DECK_METHODS = [
  { id: "mirror", label: "Mirror mine" },
  { id: "generated", label: "Randomly generated" },
  { id: "random-owned", label: "Random from my decks" },
];

/** @returns {object} the roster entry for `id` */
export function getBot(id) {
  return BOTS.find((bot) => bot.id === id) ?? BOTS[0];
}

/** @returns {object} the deck-method entry for `id` */
export function getDeckMethod(id) {
  return DECK_METHODS.find((method) => method.id === id) ?? DECK_METHODS[0];
}
