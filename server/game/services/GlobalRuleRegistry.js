import * as IdFactory from "../IdFactory.js";

/**
 * Registers landmark `rules` as source-tracked board entries.
 *
 * A landmark's `rules` are always-on battlefield rules, distinct from unit
 * passives (see PASSIVE_SYSTEM_ARCHITECTURE.md). This registry anchors each
 * rule to its landmark's source ID so the rules are revoked by source when the
 * landmark leaves play, and its provenance is serialized like any other
 * modifier. It owns registration/revocation only — the consuming systems read
 * the `rule` entries and apply each rule's behavior.
 */
export default class GlobalRuleRegistry {
  /**
   * Register a landmark's rules onto the board.
   *
   * @param {import('../Unit.js').default} unit — the landmark unit
   * @param {import('../GameState.js').default} gameState
   */
  registerUnit(unit, gameState) {
    if (!unit || unit.card?.kind !== "landmark") return;
    const rules = unit.card.rules || [];
    if (rules.length === 0) return;

    const sourceId = IdFactory.landmarkSource(unit.id);
    for (const rule of rules) {
      gameState.modifierStack.apply({
        sourceId,
        sourceType: "landmark",
        targetId: unit.id,
        type: "rule",
        key: rule.type,
        value: 1,
        meta: { rule },
      });
    }
  }

  /**
   * Revoke every rule a landmark registered.
   *
   * @param {string} unitId — the landmark's instance id
   * @param {import('../GameState.js').default} gameState
   */
  unregisterUnit(unitId, gameState) {
    gameState.modifierStack.removeBySource(IdFactory.landmarkSource(unitId));
  }
}
