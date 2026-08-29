import BaseHandler from "./BaseHandler.js";

/**
 * Resolves a `choose_position` effect: the source unit's owner picks one of
 * the five canonical positions. The choice is stored on the unit (not the
 * unit's own card positions — landmarks have none) and activates any
 * `position: "chosen"` rule through `GlobalRuleRegistry.registerUnit`.
 *
 * The source unit arrives in the resolution extra (`sourceUnit`), never as a
 * target descriptor, so the effect is relative to whatever card resolves it.
 */
export default class ChoosePositionHandler extends BaseHandler {
  validate(payload) {
    if (!payload.sourceUnit) {
      throw new Error("ChoosePositionHandler: payload.sourceUnit is required");
    }
  }

  execute(payload, context, gameState) {
    const unit = payload.sourceUnit;
    if (unit.chosenPositionCode) {
      return { chosen: false, reason: "already_chosen" };
    }
    // A trigger can be revisited while this unit's own earlier decision is
    // pending. Leave the existing decision in charge rather than creating
    // duplicates.
    if (
      gameState.pendingDecision?.type === "position_selection" &&
      gameState.pendingDecision.unitId === unit.id
    ) {
      return { chosen: false, reason: "decision_pending" };
    }

    const positions = gameState.constructor.positions;
    const candidates = Object.keys(positions)
      .filter((code) => positions[code].special === false)
      .sort()
      .map((code) => ({ id: code, name: positions[code].name }));

    gameState.createPendingDecision({
      owner: unit.owner,
      type: "position_selection",
      unitId: unit.id,
      candidates,
      minChoices: 1,
      maxChoices: 1,
      resolve: ([positionCode]) => {
        // The unit may have left play while its choice was pending.
        // A unit off the field must never recreate its rules or grants.
        if (gameState._findUnit(unit.id) !== unit || !unit.isAlive()) return;
        if (!candidates.some((candidate) => candidate.id === positionCode)) {
          throw new Error(`Invalid selected position: ${positionCode}`);
        }
        unit.chosenPositionCode = positionCode;
        gameState._globalRuleRegistry?.registerUnit(unit, gameState);
        gameState._globalRuleRegistry?.reconcile(gameState);
      },
    });
    return { pending: true };
  }
}
