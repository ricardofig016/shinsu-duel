/**
 * Validates skill/equipment requirements before card play.
 *
 * Requirements are raw strings from compiled card data, like:
 *   "deployed as Fisherman"  — unit must be in this position
 *   "target is an ally"      — target must be owned by same player
 *   "target is a Ranker"     — target's rank must match
 *
 * Validation happens BEFORE cost deduction to prevent partial state.
 */

export default class RequirementValidator {
  /**
   * Validate a list of requirements against the current game state.
   *
   * @param {string[]} requirements — raw requirement strings
   * @param {object} context — { gameState, sourceUnit, targetUnit, card }
   * @throws {Error} if any requirement is unmet
   */
  static validate(requirements, context) {
    if (!requirements || requirements.length === 0) return;

    const { gameState, sourceUnit, targetUnit } = context;

    for (const req of requirements) {
      const text = String(req).trim().toLowerCase();

      // "deployed as <position>"
      const deployedMatch = /^deployed as (.+)$/.exec(text);
      if (deployedMatch) {
        const requiredPos = deployedMatch[1].trim();
        if (!sourceUnit || sourceUnit.placedPositionCode !== requiredPos) {
          throw new Error(
            `Requirement not met: must be deployed as ${requiredPos}`
          );
        }
        continue;
      }

      // "target is an ally"
      if (text.includes("target is an ally")) {
        if (!targetUnit || !sourceUnit) {
          throw new Error("Requirement not met: target must be an ally");
        }
        if (targetUnit.owner !== sourceUnit.owner) {
          throw new Error("Requirement not met: target must be an ally");
        }
        continue;
      }

      // "target is an enemy"
      if (text.includes("target is an enemy")) {
        if (!targetUnit || !sourceUnit) {
          throw new Error("Requirement not met: target must be an enemy");
        }
        if (targetUnit.owner === sourceUnit.owner) {
          throw new Error("Requirement not met: target must be an enemy");
        }
        continue;
      }

      // "target is a <rank>"
      const rankMatch = /^target is (?:a |an )?(regular|ranker|high ranker)$/.exec(text);
      if (rankMatch) {
        if (!targetUnit || targetUnit.card?.rank !== rankMatch[1]) {
          throw new Error(`Requirement not met: target must be a ${rankMatch[1]}`);
        }
        continue;
      }

      // Unknown requirement — log as warning but don't block
      // Phase 4 will handle custom requirements
    }
  }
}
