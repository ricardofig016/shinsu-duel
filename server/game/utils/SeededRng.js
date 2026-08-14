/**
 * Deterministic seeded RNG.
 *
 * Implements the mulberry32 PRNG so that games using a seeded RNG can be
 * replayed byte-for-byte. Exposes a serializable state `{ seed, calls }` so
 * the Logger can capture the exact RNG position alongside game snapshots.
 *
 * Replay contract:
 *  - A game created with a `SeededRng` is fully deterministic.
 *  - `getState()` returns the seed and the number of draws consumed so far.
 *  - `restoreState()` re-seeds and fast-forwards to the same draw count,
 *    reproducing the identical subsequent sequence.
 */

import crypto from "node:crypto";

export default class SeededRng {
  /**
   * @param {number} seed 32-bit unsigned integer seed.
   */
  constructor(seed) {
    this._seed = seed >>> 0;
    this._calls = 0;
    this._state = this._seed;
  }

  /**
   * @returns {number} A float in [0, 1).
   */
  next() {
    this._calls++;
    // mulberry32
    this._state = (this._state + 0x6d2b79f5) >>> 0;
    let t = this._state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** @returns {{ seed: number, calls: number }} Serialized RNG position. */
  getState() {
    return { seed: this._seed, calls: this._calls };
  }

  /**
   * Restore the RNG to a previously captured state so the next `next()` call
   * produces the same value it would have at that point in the original run.
   *
   * @param {{ seed: number, calls: number }} state
   */
  restoreState(state) {
    if (!state || typeof state.seed !== "number") {
      throw new Error("SeededRng.restoreState requires { seed, calls }");
    }
    this._seed = state.seed >>> 0;
    this._state = this._seed;
    this._calls = 0;
    for (let i = 0; i < (state.calls || 0); i++) {
      this._calls++;
      this._state = (this._state + 0x6d2b79f5) >>> 0;
      let t = this._state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    }
  }
}

/**
 * Generate a cryptographically secure 32-bit unsigned seed for a new game.
 * This is the only acceptable source of a game seed in production
 *
 * @returns {number} an integer in [0, 2^32 - 1].
 */
export function generateSeed() {
  return crypto.randomInt(0, 0x100000000);
}
