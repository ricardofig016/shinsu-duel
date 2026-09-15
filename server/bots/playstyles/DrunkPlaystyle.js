import shuffle from "../../game/utils/shuffle.js";
import { choiceCountRange, freeCandidateIds } from "./decisions.js";

const PASS = { type: "pass-turn-action", data: {} };
const FIELD_LINES = ["frontline", "backline"];
const FULL_LINE_SIZE = 5;

/**
 * The "Drunk" playstyle: each turn a uniformly random pick over the moves it
 * can verify from its own seat view; each decision a random valid subset.
 *
 * The verifiable pool mirrors the engine's own deploy preconditions, so a
 * picked move never reaches the engine invalid: pass (always), generate a
 * fire charge (a Hwayeomsa unit on the field and at least 1 shinsu — exactly
 * the engine's preconditions), or deploy an affordable standard unit to one
 * of its printed positions on a line with room (no same-name unit already
 * deployed). Everything else — skills, equipment, non-standard kinds,
 * overflow deployments — stays out of the pool.
 */
export default class DrunkPlaystyle {
  /**
   * Choose the turn action from the seat view.
   *
   * @param {object} view the seat's redacted state view
   * @param {{ next(): number }} rng seeded rng
   * @returns {{ type: string, data: object }} a player action without identity fields
   */
  decideTurn(view, rng) {
    const candidates = this.#turnCandidates(view);
    return candidates[Math.floor(rng.next() * candidates.length)];
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
   * Every turn action this seat could legally submit right now, computed
   * from the view alone.
   */
  #turnCandidates(view) {
    const you = view?.you;
    if (!you) return [PASS];

    const candidates = [PASS];
    const totalShinsu = (you.shinsu?.normalAvailable ?? 0) + (you.shinsu?.recharged ?? 0);

    if (this.#canGenerateFireCharge(you, totalShinsu)) {
      candidates.push({ type: "generate-fire-charge-action", data: {} });
    }

    const deployedNames = new Set(
      FIELD_LINES.flatMap((line) => (you.field?.[line] ?? []).map((unit) => unit.card?.name)).filter(Boolean)
    );
    const lineSizes = Object.fromEntries(FIELD_LINES.map((line) => [line, (you.field?.[line] ?? []).length]));

    (you.hand ?? []).forEach((card, handId) => {
      if (card.type !== "unit" || card.kind !== "standard") return;
      const positionCodes = Object.keys(card.positions ?? {});
      if (positionCodes.length === 0) return;
      if ((card.effectiveCost ?? card.cost ?? 0) > totalShinsu) return;
      if (deployedNames.has(card.name)) return;

      for (const code of positionCodes) {
        const line = card.positions[code]?.line;
        if (!line || lineSizes[line] >= FULL_LINE_SIZE) continue;
        candidates.push({ type: "deploy-unit-action", data: { handId, placedPositionCode: code } });
      }
    });

    return candidates;
  }

  /** The engine's own fire-charge preconditions, both view-verifiable. */
  #canGenerateFireCharge(you, totalShinsu) {
    if (totalShinsu < 1) return false;
    return FIELD_LINES.some((line) =>
      (you.field?.[line] ?? []).some((unit) => Object.hasOwn(unit.card?.attributes ?? {}, "hwayeomsa"))
    );
  }
}
