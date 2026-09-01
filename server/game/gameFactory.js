/**
 * Game construction boundary — the single place a seed is turned into a
 * concrete `GameState`.
 *
 * Responsibilities:
 *  - Validate the seed and build a `SeededRng` from it.
 *  - Roll the first player (seeded) when no explicit first player is given.
 *  - Generate shuffled default decks (seeded) when no explicit deck is given.
 *
 * Keeping the seeded first-player roll and deck shuffle OUTSIDE the
 * `GameState` constructor means the constructor itself never consumes RNG.
 * That keeps replay construction RNG-neutral: `ReplayDriver` reconstructs a
 * game from recorded decks + first player with an RNG at zero calls, matching
 * the original initial state.
 */

import GameState from "./GameState.js";
import SeededRng from "./utils/SeededRng.js";
import shuffle from "./utils/shuffle.js";

/**
 * @param {Object} args
 * @param {string} args.roomCode unique room code for this game
 * @param {Array<string>} args.usernames exactly 2 usernames
 * @param {number} args.seed 32-bit unsigned integer seed
 * @param {Object} [args.decks] optional map of username → cardIds; omitted
 *   usernames receive a seeded shuffled default deck
 * @param {string} [args.firstPlayer] optional first-turn username; when
 *   omitted, the first player is rolled deterministically from the seed
 * @param {Array} [args.loggerBackends] extra Logger backends attached at game
 *   construction so they observe every entry, including InitialState
 * @returns {GameState}
 */
export function createSeededGame({ roomCode, usernames, seed, decks = null, firstPlayer = null, cards = null, loggerBackends = [] }) {
  if (typeof seed !== "number" || !Number.isFinite(seed)) {
    throw new Error("createSeededGame requires a numeric seed.");
  }
  if (!Array.isArray(loggerBackends)) {
    throw new TypeError("loggerBackends must be an array of Logger backends.");
  }

  const rng = new SeededRng(seed);
  const resolvedFirstPlayer =
    firstPlayer || (rng.next() < 0.5 ? usernames[0] : usernames[1]);

  const resolvedDecks = {};
  for (const username of usernames) {
    resolvedDecks[username] = decks?.[username] ?? buildDefaultDeck(rng, cards);
  }

  return new GameState(roomCode, usernames, resolvedDecks, resolvedFirstPlayer, { rng, cards, loggerBackends });
}

/**
 * Build a legal 30-card deck by shuffling the eligible card pool with the
 * given RNG and taking the first 30. Deterministic for a fixed RNG.
 *
 * @param {{ next(): number }} rng
 * @param {object} [cards] optional card catalog (defaults to the compiled static)
 * @returns {Array<number>}
 */
function buildDefaultDeck(rng, cards = null) {
  const eligible = GameState.getEligibleCardIds(cards ?? GameState.cards);
  if (eligible.length < GameState.INIT_DECK_SIZE) {
    throw new Error("Not enough eligible cards to generate a legal deck.");
  }
  const pool = [...eligible];
  shuffle(pool, rng);
  return pool.slice(0, GameState.INIT_DECK_SIZE);
}
