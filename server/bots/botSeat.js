import SeededRng from "../game/utils/SeededRng.js";
import { getBot } from "./botCatalog.js";
import { createPlaystyleRegistry } from "./playstyleRegistry.js";
import { createDeckMethodRegistry } from "./deckMethodRegistry.js";
import BotSeatController from "./BotSeatController.js";

/** The playstyles a room's bot spec may name. */
export const botPlaystyles = createPlaystyleRegistry();

/** The deck methods a room's bot spec may name. */
export const botDeckMethods = createDeckMethodRegistry();

const BOT_SEED_SALT = 0x5f3759df;

/**
 * Derive a bot seat's rng seed from the room seed, deterministically. Bots
 * sample with their own rng stream so a seeded room replays identically end
 * to end, independent of how many draws the engine itself consumes.
 *
 * @param {number} seed the room's game seed
 * @returns {number} a 32-bit unsigned seed for the bot seat
 */
export function deriveBotSeed(seed) {
  return ((seed >>> 0) ^ BOT_SEED_SALT) >>> 0;
}

/**
 * Validate a room record's bot spec. A bot room's record carries
 * `{ bot: "<playstyle id>", deckMethod: "<deck method id>" }`; anything else
 * is a broken record a connection refuses rather than defaults.
 *
 * @param {object|undefined} bot the room record's `bot` field
 * @returns {object|null} the spec, or null when it is missing or names an unknown id
 */
export function parseBotSpec(bot) {
  if (!bot || typeof bot !== "object" || typeof bot.bot !== "string" || typeof bot.deckMethod !== "string") {
    return null;
  }
  if (!botPlaystyles.has(bot.bot) || !botDeckMethods.has(bot.deckMethod)) {
    return null;
  }
  return bot;
}

/**
 * Assemble one room's bot seat.
 *
 * The spec is validated here, making `createBotSeat` the single refusal
 * point for a broken room record: an unknown playstyle or deck method, or a
 * missing spec, throws and the caller refuses the connection. The seat is
 * named from the roster, behaves through the spec's playstyle, fields decks
 * through the spec's deck method, and answers moves through a controller
 * bound to the session registry and the gateway's validated paths. Its rng
 * is the room seed's bot derivation, so the seat plays the same game a
 * replay would.
 *
 * @param {object} args
 * @param {string} args.roomCode the room this seat plays in
 * @param {object|undefined} args.spec the room record's `bot` field
 * @param {number} args.seed the room's game seed
 * @param {string} args.opponentName the human seat the bot plays against
 * @param {object} args.registry the session registry, read fresh on every submission
 * @param {object} args.submitter the gateway's validated paths
 * @returns {{ botId: string, seatName: string, deckMethodId: string, deckMethod: object, opponentName: string, rng: object, controller: BotSeatController }}
 * @throws {Error} when the spec is missing or names an unknown playstyle or deck method
 */
export function createBotSeat({ roomCode, spec, seed, opponentName, registry, submitter }) {
  if (typeof opponentName !== "string" || opponentName.trim() === "") {
    throw new TypeError("opponentName must be a non-empty string.");
  }
  const spec_ = parseBotSpec(spec);
  if (!spec_) {
    throw new TypeError("A bot seat needs a bot spec naming a known playstyle and deck method.");
  }
  const bot = getBot(spec_.bot);
  const rng = new SeededRng(deriveBotSeed(seed));
  return {
    botId: bot.id,
    seatName: bot.seatName,
    deckMethodId: spec_.deckMethod,
    deckMethod: botDeckMethods.get(spec_.deckMethod),
    opponentName,
    rng,
    controller: new BotSeatController({
      roomCode,
      seatName: bot.seatName,
      playstyle: botPlaystyles.get(spec_.bot),
      rng,
      registry,
      submitter,
    }),
  };
}
