import shuffle from "../../game/utils/shuffle.js";
import { choiceCountRange, freeCandidateIds } from "./decisions.js";
import { moveKey, projectTurnOptions } from "../turnOptions.js";

const PASS = { type: "pass-turn-action", data: {} };

/**
 * The "Drunk" playstyle: each turn a uniformly random pick over the seat's
 * projected move pool; each decision a random valid subset.
 *
 * The pool comes from `server/bots/turnOptions.js`, the one projection of the
 * engine's action preconditions, so this playstyle owns no candidate logic of
 * its own — it only chooses. Pass does nothing, so it is held back until it is
 * the only move left; every other move is equally likely.
 */
export default class DrunkPlaystyle {
  /**
   * Choose the turn action from the seat view.
   *
   * @param {object} view the seat's redacted state view
   * @param {{ next(): number }} rng seeded rng
   * @param {Set<string>} [excluded] move keys already offered this snapshot
   * @returns {{ type: string, data: object }} a player action without identity fields
   */
  decideTurn(view, rng, excluded = new Set()) {
    return this.#pick(view, rng, excluded);
  }

  /**
   * Choose the next move after a refusal: the same pool, minus everything
   * already attempted, through the same selection. The pool is finite, so a
   * seat whose every move is refused drains to a pass.
   *
   * @param {object} view the seat's redacted state view
   * @param {Set<string>} excluded move keys already offered this snapshot
   * @param {{ next(): number }} rng seeded rng
   * @returns {{ type: string, data: object }} a player action without identity fields
   */
  resolveRetry(view, excluded, rng) {
    return this.#pick(view, rng, excluded);
  }

  /**
   * Resolve a pending decision owned by the seat.
   *
   * @param {object} decision the pending decision from the seat view
   * @param {{ next(): number }} rng seeded rng
   * @returns {{ decisionId: string, choices: string[] }}
   */
  resolveDecision(decision, rng) {
    const pool = freeCandidateIds(decision);
    const { min, max } = choiceCountRange(decision);
    const high = Math.min(max, pool.length);
    const count = Math.min(min, pool.length) + Math.floor(rng.next() * (high - Math.min(min, pool.length) + 1));
    return { decisionId: decision.decisionId, choices: shuffle([...pool], rng).slice(0, count) };
  }

  /**
   * A uniform pick over the projected pool: the moves `excluded` does not
   * name, with pass dropped while any other move remains. Pass is the fallback
   * when nothing is left to choose from.
   */
  #pick(view, rng, excluded) {
    const offered = projectTurnOptions(view);
    const attempted = excluded instanceof Set ? excluded : new Set(excluded ?? []);
    const remaining = offered.filter((move) => !attempted.has(moveKey(move)));
    const playable = remaining.filter((move) => move.type !== "pass-turn-action");
    const candidates = playable.length > 0 ? playable : remaining;
    if (candidates.length === 0) return PASS;

    const index = Math.min(candidates.length - 1, Math.floor(rng.next() * candidates.length));
    return candidates[index];
  }
}
