import { choiceCountRange, freeCandidateIds } from "./decisions.js";

/** A fresh pass move: the seat's own action payload is stamped and mutated, so a move is never shared. */
const passMove = () => ({ type: "pass-turn-action", data: {} });

/**
 * The "Whatever" playstyle: pass every turn, and when the game forces a
 * choice, take the first valid ones. Indifference, expressed mechanically.
 *
 * Like every playstyle it is a pure function of the seat's own redacted view
 * and the seeded rng it is handed — it never sees more than a human seat
 * would and holds no state between moves. Its retry is the same pass: it has
 * no pool to drain, so a refusal costs it nothing it would have used.
 */
export default class WhateverPlaystyle {
  /**
   * Choose the turn action from the seat view.
   *
   * @param {object} _view the seat's redacted state view (ignored)
   * @param {{ next(): number }} _rng seeded rng (unused — passing is no choice at all)
   * @returns {{ type: string, data: object }} a player action without identity fields
   */
  decideTurn(_view, _rng) {
    return passMove();
  }

  /**
   * Choose the next move after a refusal, which for this playstyle is the same
   * pass. Nothing is excluded because nothing else was ever offered.
   *
   * @param {object} _view the seat's redacted state view (ignored)
   * @param {Set<string>} _excluded move keys already offered (ignored)
   * @param {{ next(): number }} _rng seeded rng (unused)
   * @returns {{ type: string, data: object }} a player action without identity fields
   */
  resolveRetry(_view, _excluded, _rng) {
    return passMove();
  }

  /**
   * Resolve a pending decision owned by the seat.
   *
   * @param {object} decision the pending decision from the seat view
   * @returns {{ decisionId: string, choices: string[] }}
   */
  resolveDecision(decision) {
    const { min } = choiceCountRange(decision);
    return {
      decisionId: decision.decisionId,
      choices: freeCandidateIds(decision).slice(0, min),
    };
  }
}
