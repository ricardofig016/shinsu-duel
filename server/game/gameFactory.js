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
 * The deck shuffle does consume draws before the constructor runs, though:
 * `GameState` records that exact RNG position in its `InitialState` metadata
 * (`meta.rngState`), and `ReplayDriver` restores it before reconstructing, so
 * a replayed game's subsequent draws stay aligned with the log.
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
 *   usernames receive a seeded shuffled default deck. Explicit decks are
 *   shuffled with the same seed before construction: the stored order is the
 *   builder's order, and the deal must not leak it to the player.
 * @param {boolean} [args.enforceDeckRules] whether the engine enforces the
 *   RULES.md deck rules on the dealt decks (default true); dev rooms pass
 *   false to deal decks that only satisfy the buildable contract
 * @param {string} [args.firstPlayer] optional first-turn username; when
 *   omitted, the first player is rolled deterministically from the seed
 * @param {Array} [args.loggerBackends] extra Logger backends attached at game
 *   construction so they observe every entry, including InitialState
 * @returns {GameState}
 */
export function createSeededGame({ roomCode, usernames, seed, decks = null, enforceDeckRules = true, firstPlayer = null, cards = null, loggerBackends = [] }) {
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
    const explicit = decks?.[username];
    resolvedDecks[username] = explicit ? shuffle([...explicit], rng) : buildDefaultDeck(rng, cards);
  }

  return new GameState(roomCode, usernames, resolvedDecks, resolvedFirstPlayer, {
    rng,
    cards,
    enforceDeckRules,
    loggerBackends,
  });
}

/**
 * Build a legal 30-card deck by shuffling the default-deck pool (every
 * deck-legal card — no Unreachable, no test cards — up to
 * `MAX_CARD_COPIES` copies each) with the given RNG and taking the first 30.
 * Deterministic for a fixed RNG.
 *
 * @param {{ next(): number }} rng
 * @param {object} [cards] optional card catalog (defaults to the compiled static)
 * @returns {Array<number>}
 */
function buildDefaultDeck(rng, cards = null) {
  const pool = GameState.getDeckPoolCardIds(cards ?? GameState.cards);
  if (pool.length < GameState.INIT_DECK_SIZE) {
    throw new Error("Not enough eligible cards to generate a legal deck.");
  }
  shuffle(pool, rng);
  return pool.slice(0, GameState.INIT_DECK_SIZE);
}
