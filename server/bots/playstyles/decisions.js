/**
 * The free-choice projection of a pending decision for a bot policy.
 *
 * A decision's `candidates` are the ids the seat may still pick and
 * `lockedIds` are engine-committed picks that must never be submitted; a
 * valid resolution chooses between `minChoices` and `maxChoices` of the free
 * ones. Both playstyles resolve decisions through this projection so the
 * view-verifiable contract stays in one place.
 */

/**
 * @param {object} decision a pending decision as it appears in the seat view
 * @returns {string[]} candidate ids minus the locked ones
 */
export function freeCandidateIds(decision) {
  const locked = new Set(decision?.lockedIds ?? []);
  return (decision?.candidates ?? [])
    .map((candidate) => candidate.id)
    .filter((id) => !locked.has(id));
}

/**
 * @param {object} decision a pending decision as it appears in the seat view
 * @returns {{ min: number, max: number }} the valid choice-count range
 */
export function choiceCountRange(decision) {
  const min = decision?.minChoices ?? 1;
  return { min, max: decision?.maxChoices ?? min };
}
