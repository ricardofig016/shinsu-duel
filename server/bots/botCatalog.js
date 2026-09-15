/**
 * The bot roster: every shippable bot opponent and its identity.
 *
 * A bot is a playstyle plus presentation metadata. The behavioral half lives
 * in the playstyle registry; this list is what the room API validates a bot
 * selection against and what names a bot seat. The seat name is a username
 * string like any other (it surfaces in the deck reveal, the turn banner,
 * and the winner line), prefixed with `[BOT]` so it can never be mistaken
 * for a human account.
 */

export const BOTS = Object.freeze([
  {
    id: "whatever",
    name: "Whatever",
    seatName: "[BOT] Whatever",
    blurb: "Could not care less. Passes. Every turn. Forever.",
  },
  {
    id: "drunk",
    name: "Drunk",
    seatName: "[BOT] Drunk",
    blurb: "Plays whatever the shinsu spirits whisper. Card? Slot? Who knows.",
  },
]);

/**
 * @param {string} id a bot id from the roster
 * @returns {object} the roster entry: `{ id, name, seatName, blurb }`
 */
export function getBot(id) {
  const bot = BOTS.find((entry) => entry.id === id);
  if (!bot) throw new Error(`Unknown bot: "${id}"`);
  return bot;
}
