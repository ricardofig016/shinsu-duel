import ActionHandler from "../ActionHandler.js";
import CombatSlotService from "../services/CombatSlotService.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import EVT from "../EventCatalog.js";

/** RULES.md §Combat Slots 6: a switch spends the slot of the position it leaves. */
function departureSlotSpent(positionCode) {
  return new Error(`Combat slot for ${positionCode} is already spent this round, so the unit cannot switch out of it.`);
}

/** Spend a turn to move one owned unit to another position printed on its card. */
export default class SwitchPositionAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    unitId: "string",
    positionCode: "string",
  };
  static sourceAccess = { player: true, debug: false, system: false };

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
    // Checked last, so every refusal that already existed keeps its own message:
    // whose turn it is, whether the unit may move at all, and whether the move is
    // a real one are all answered before whether it can be paid for. Only the
    // departure's slot is read — the destination's availability is irrelevant.
    if (!CombatSlotService.isAvailable(player, unit.placedPositionCode)) {
      throw departureSlotSpent(unit.placedPositionCode);
    }
  }

  execute(data, gameState) {
    const player = gameState.playerStates[data.username];
    const unit = gameState._findUnit(data.unitId);

    // Read the departure position before the switch moves the unit, and spend
    // through the slot service, the only writer of a combat slot. `validate`
    // refuses a spent departure, so a false here is a broken invariant.
    if (!CombatSlotService.consume(player, unit.placedPositionCode)) {
      throw departureSlotSpent(unit.placedPositionCode);
    }

    LifecycleEngine.switchPosition(gameState, unit, data.positionCode);
    gameState.eventBus.emit(EVT.UNIT_POSITION_SWITCHED, {
      unitId: unit.id,
      owner: unit.owner,
      positionCode: data.positionCode,
    });
    gameState.endTurn();
  }
}
