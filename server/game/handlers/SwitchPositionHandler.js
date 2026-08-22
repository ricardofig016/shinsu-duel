import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import EVT from "../EventCatalog.js";

/**
 * Forces a unit to switch to one of its other printed positions.
 *
 * DSL type: switch_position
 *
 * Only legal destinations are offered: a position other than the current one
 * whose destination line is not full (a full line would overflow and destroy
 * the unit). The acting player chooses among the legal destinations; a single
 * legal destination applies immediately. Rooted units cannot switch.
 *
 * Target eligibility (enemies that can legally switch) is enforced upstream by
 * the `can_switch` target filter in TargetResolver.
 *
 * Payload:
 *   { targetId, sourceOwner }
 */
export default class SwitchPositionHandler extends BaseHandler {
  validate(payload) {
    if (!payload.targetId) throw new Error("SwitchPositionHandler: payload.targetId is required");
  }

  execute(payload, context, gameState) {
    const { targetId, sourceOwner } = payload;
    const unit = gameState._findUnit(targetId);
    if (!unit || !unit.isAlive()) return { switched: false };

    if (gameState.modifierStack.has(unit.id, "condition", "rooted")) {
      return { switched: false, reason: "rooted" };
    }

    const positions = Object.keys(unit.card.positions || {})
      .filter((p) => p !== unit.placedPositionCode)
      .filter((p) => {
        const line = gameState.constructor.positions[p]?.line;
        return line && gameState.playerStates[unit.owner]?.field?.[line]?.length < 5;
      });

    if (positions.length === 0) return { switched: false, reason: "no legal position" };

    const switchTo = (positionCode) => {
      LifecycleEngine.switchPosition(gameState, unit, positionCode);
      gameState.eventBus.emit(EVT.UNIT_POSITION_SWITCHED, {
        unitId: unit.id,
        owner: unit.owner,
        positionCode,
      });
    };

    if (positions.length === 1) {
      switchTo(positions[0]);
      return { switched: true, positionCode: positions[0] };
    }

    gameState.createPendingDecision({
      owner: sourceOwner || payload.owner,
      type: "position_selection",
      candidates: positions.map((p) => ({
        id: p,
        name: gameState.constructor.positions[p]?.name || p,
        hp: 0,
      })),
      minChoices: 1,
      maxChoices: 1,
      resolve: ([positionCode]) => switchTo(positionCode),
    });
    return { switched: true, pending: true };
  }
}
