/**
 * Deterministic replay driver.
 *
 * Reconstructs a game from a replay log produced by `Logger.getReplayLog()`:
 *
 *   1. Resets all global ID/modifier counters.
 *   2. Rebuilds `GameState` from the recorded initial metadata (decks, first
 *      player, RNG seed).
 *   3. Verifies the reconstructed initial state is byte-identical to the
 *      recorded initial state.
 *   4. Re-applies each recorded player input, asserting that the full
 *      serialized state after every step matches the recorded state.
 *
 * Replay is only possible for games that used a seeded RNG (see
 * `SeededRng`); an unseeded RNG produces no captureable state.
 */

import GameState from "../GameState.js";
import * as IdFactory from "../IdFactory.js";
import { setModifierCounter } from "../ModifierStack.js";
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

    const { roomCode, usernames, decks, firstPlayer, rngSeed, startingCounters, startingModifierCounter } = initial.meta;
    if (rngSeed === null || rngSeed === undefined) {
      throw new Error("Replay requires a seeded RNG (rngSeed is missing from the log).");
    }

    // Restore the exact ID-counter position captured before the original game
    // constructed its entities, so the replay reproduces identical ids.
    IdFactory.setCounters(startingCounters);
    setModifierCounter(startingModifierCounter ?? 0);

    const game = new GameState(roomCode, usernames, decks, firstPlayer, {
      rng: new SeededRng(rngSeed),
      cards,
    });

    assertEqual(game.toSerializedState(), initial.state, "initial state");

    for (let i = 0; i < (actions || []).length; i++) {
      const entry = actions[i];
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

      assertEqual(game.toSerializedState(), entry.stateAfter, `step ${i} (${entry.type})`);
    }

    return game;
  }
}
