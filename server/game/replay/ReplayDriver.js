/**
 * Deterministic replay driver.
 *
 * Reconstructs a game from a replay log produced by `Logger.getReplayLog()`:
 *
 *   1. Restores the global ID/modifier counters and the RNG position
 *      recorded at construction time.
 *   2. Rebuilds `GameState` from the recorded initial metadata (decks, first
 *      player, RNG seed).
 *   3. Verifies the reconstructed initial state is byte-identical to the
 *      recorded initial state.
 *   4. Re-applies each recorded player input and steps an in-memory
 *      expected state forward with the recorded diff, asserting that the
 *      full serialized state matches after every step. Failed inputs record
 *      an empty diff, so replay also asserts they changed nothing.
 *
 * The artifact stores only the fields each step changed; the driver
 * accumulates them into the full expected state, keeping verification
 * byte-for-byte while the file stays small. Legacy artifacts that stored a
 * full `stateAfter` per entry are rejected loudly.
 *
 * Replay is only possible for games that used a seeded RNG (see
 * `SeededRng`); an unseeded RNG produces no captureable state.
 */

import GameState from "../GameState.js";
import * as IdFactory from "../IdFactory.js";
import { setModifierCounter } from "../ModifierStack.js";
import { applyStateDiff } from "../utils/stateDiff.js";
import SeededRng from "../utils/SeededRng.js";

function assertEqual(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(
      `Replay divergence at ${label}. Serialized states differ.\n` +
      `Expected: ${e.slice(0, 500)}\nActual:   ${a.slice(0, 500)}`
    );
  }
}

export default class ReplayDriver {
  /**
   * Replay a recorded game and return the reconstructed `GameState`.
   *
   * @param {{ initial: object|null, actions: Array<object> }} replayLog
   * @returns {GameState}
   */
  static replay(replayLog, { cards = null } = {}) {
    const { initial, actions } = replayLog || {};
    if (!initial) throw new Error("Replay log is missing its initial state.");

    const { roomCode, usernames, decks, firstPlayer, rngSeed, rngState, startingCounters, startingModifierCounter } = initial.meta;
    if (rngSeed === null || rngSeed === undefined) {
      throw new Error("Replay requires a seeded RNG (rngSeed is missing from the log).");
    }

    // Restore the exact ID-counter position captured before the original game
    // constructed its entities, so the replay reproduces identical ids.
    IdFactory.setCounters(startingCounters);
    setModifierCounter(startingModifierCounter ?? 0);

    // Restore the exact RNG position the original game started from: decks
    // built by the game factory consume draws before GameState exists, and
    // later draws (e.g. Blinded targeting) must stay aligned with the log.
    const rng = new SeededRng(rngSeed);
    if (rngState) rng.restoreState(rngState);

    const game = new GameState(roomCode, usernames, decks, firstPlayer, {
      rng,
      cards,
    });

    assertEqual(game.toSerializedState(), initial.state, "initial state");

    // The expected state is accumulated in memory: each recorded diff turns
    // the previous expected state into the next one, so every step can still
    // be asserted against a full serialized state.
    let expected = initial.state;

    for (let i = 0; i < (actions || []).length; i++) {
      const entry = actions[i];
      if (entry.stateAfter !== undefined) {
        throw new Error(
          `Replay entry ${i} (${entry.type}) carries a full stateAfter — legacy artifacts are no longer supported.`
        );
      }
      const diff = entry.diff;
      if (!diff || typeof diff !== "object" || !diff.changed || typeof diff.changed !== "object" || !Array.isArray(diff.removed)) {
        throw new Error(`Replay entry ${i} (${entry.type}) is missing a well-formed { changed, removed } diff.`);
      }

      let threw = false;
      try {
        if (entry.type === "UserAction") {
          game.processAction(entry.action);
        } else if (entry.type === "UserDecision") {
          game.resolveDecision(entry.decision);
        } else {
          throw new Error(`Unknown replay entry type: ${entry.type}`);
        }
      } catch (error) {
        threw = true;
        if (entry.ok) throw error; // an unexpected failure during replay
      }

      if (!entry.ok && !threw) {
        throw new Error(`Expected replay step ${i} (${entry.type}) to fail, but it succeeded.`);
      }

      expected = applyStateDiff(expected, diff);
      assertEqual(game.toSerializedState(), expected, `step ${i} (${entry.type})`);
    }

    return game;
  }
}
