import { choiceCountRange, freeCandidateIds } from "./decisions.js";

/**
 * The "Whatever" playstyle: pass every turn, and when the game forces a
 * choice, take the first valid ones. Indifference, expressed mechanically.
 *
 * Like every playstyle it is a pure function of the seat's own redacted view
 * and the seeded rng it is handed — it never sees more than a human seat
 * would and holds no state between moves.
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
    return { type: "pass-turn-action", data: {} };
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
