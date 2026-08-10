import ActionHandler from "../ActionHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import RequirementValidator from "../services/RequirementValidator.js";
import ShinsuService from "../services/ShinsuService.js";

/** Equips a hand card through the authoritative lifecycle engine. */
export default class EquipEquipmentAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    handId: "number",
    targetUnitId: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    const player = gameState.playerStates[data.username];
    if (!player) throw new Error(`Player ${data.username} not found.`);
    if (gameState.currentTurn !== data.username) throw new Error("It's not your turn.");
    const card = player.hand[data.handId];
    const targetUnit = gameState._findUnit(data.targetUnitId);
    if (!card || card.type !== "equipment") throw new Error("Card is not equipment or not in hand.");
    if (!targetUnit || targetUnit.owner !== data.username) throw new Error("Equipment target must be an allied deployed unit.");

    const cost = Math.max(0, card.cost - (card.costReduction || 0));
    if (!ShinsuService.canAfford(player, cost)) throw new Error("Not enough shinsu to equip.");
    RequirementValidator.validate(card.requirements, { gameState, username: data.username, card, sourceUnit: targetUnit, targetUnit });
  }

  execute(data, gameState) {
    const targetUnit = gameState._findUnit(data.targetUnitId);
    LifecycleEngine.attachEquipment(gameState, data.username, data.handId, targetUnit);
    gameState.recordCardPlayed(data.username);
    gameState.endTurn();
  }
}
