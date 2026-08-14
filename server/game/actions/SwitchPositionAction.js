import ActionHandler from "../ActionHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import EVT from "../EventCatalog.js";

/** Spend a turn to move one owned unit to another position printed on its card. */
export default class SwitchPositionAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    unitId: "string",
    positionCode: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    const player = gameState.playerStates[data.username];
    if (!player) throw new Error(`Player ${data.username} not found.`);
    if (gameState.currentTurn !== data.username) throw new Error("It's not your turn.");

    const unit = gameState._findUnit(data.unitId);
    if (!unit || unit.owner !== data.username) throw new Error("Unit must be deployed on your field.");
    if (gameState.modifierStack.has(unit.id, "condition", "rooted")) {
      throw new Error("A Rooted unit cannot switch positions.");
    }
    if (!gameState.constructor.positions[data.positionCode]) {
      throw new Error(`Invalid position: ${data.positionCode}`);
    }
    if (!(data.positionCode in unit.card.positions)) {
      throw new Error(`Unit cannot be placed in position ${data.positionCode}.`);
    }
    if (unit.placedPositionCode === data.positionCode) {
      throw new Error("Unit is already in that position.");
    }
  }

  execute(data, gameState) {
    const unit = gameState._findUnit(data.unitId);
    LifecycleEngine.switchPosition(gameState, unit, data.positionCode);
    gameState.eventBus.emit(EVT.UNIT_POSITION_SWITCHED, {
      unitId: unit.id,
      owner: unit.owner,
      positionCode: data.positionCode,
    });
    gameState.endTurn();
  }
}
