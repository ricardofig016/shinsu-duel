/**
 * The single resolution of a unit's effective keyword set.
 *
 * Keywords reach a unit from two places: the ability node being used (its
 * `quick` / `free` booleans are authored keyword grants) and the ModifierStack
 * (`modify_keyword` entries, some of them `first`-scoped to the unit's first
 * ability of the round). Free, Quick, and combat-slot spending must all read
 * the same answer, so they all read it here rather than each composing it.
 */

export default class KeywordResolver {
  /**
   * Keywords the ability node itself grants, above whatever the unit carries.
   */
  static fromAbility(ability) {
    const keys = new Set();
    if (!ability) return keys;
    if (ability.quick) keys.add("quick");
    if (ability.free) keys.add("free");
    return keys;
  }

  /**
   * The keyword set the engine acts on for `unit`, with `ability`'s own
   * keywords folded in when an ability is being used.
   *
   * @param {object} gameState
   * @param {object} unit
   * @param {object|null} [ability] the ability node being used, if any
   * @param {boolean} [firstThisRound] whether the ability being used is the
   *   unit's first of the round, which is what makes a `first: true` modifier
   *   active. Defaults to the unit's own state: a unit that has not yet used
   *   an ability this round is on its first.
   * @returns {Set<string>}
   */
  static resolve(gameState, unit, ability = null, firstThisRound = null) {
    const first = firstThisRound ?? !gameState.hasUsedAbilityThisRound(unit.id);
    const keys = gameState.modifierStack.getKeywords(unit, first);
    for (const keyword of KeywordResolver.fromAbility(ability)) keys.add(keyword);
    return keys;
  }

  /**
   * The keyword set for a field unit read outside an ability use — the view
   * projection's answer. No ability node is involved, so the set holds only
   * what the unit carries, scoped to whether it has already acted this round.
   *
   * @param {object} gameState
   * @param {string} unitId
   * @returns {Set<string>}
   */
  static forUnit(gameState, unitId) {
    const unit = gameState._findUnit(unitId);
    if (!unit) return new Set();
    return KeywordResolver.resolve(gameState, unit, null, !gameState.hasUsedAbilityThisRound(unitId));
  }
}
