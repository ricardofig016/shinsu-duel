/**
 * Shared Fisher-Yates shuffle driven by a deterministic RNG.
 *
 * Every random reordering of cards or targets must go through this helper so
 * the engine has a single, seeded, replayable shuffle implementation.
 *
 * @param {Array} array mutable array to shuffle in place
 * @param {{ next(): number }} rng deterministic RNG exposing `next()`
 * @returns {Array} the same (now shuffled) array, for convenience
 */
export default function shuffle(array, rng) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
