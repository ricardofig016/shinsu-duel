import ActionHandler from "../ActionHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import ModifierService from "../services/ModifierService.js";

/**
 * Deploy a unit through the authoritative lifecycle engine.
 */
export default class DeployUnitAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    handId: "number",
    placedPositionCode: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    const { username, handId, placedPositionCode } = data;
    const playerState = gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");

    if (handId < 0 || handId >= playerState.hand.length) throw new Error("Invalid handId.");

    const card = playerState.hand[handId];
    if (!card || card.type !== "unit") throw new Error("Card is not a unit or not in hand.");

    // Standard units occupy a printed main position; special kinds carry no
    // position (their field line is authored or implied by kind).
    if (card.kind === "standard") {
      if (!gameState.constructor.positions[placedPositionCode])
        throw new Error(`Invalid placedPositionCode: ${placedPositionCode}`);
      if (!(placedPositionCode in card.positions))
        throw new Error(`Card cannot be placed in position ${placedPositionCode}.`);
    }

    const effectiveCost = ModifierService.getEffectiveCost(card, username, gameState);
    if (effectiveCost > gameState.getTotalShinsu(username))
      throw new Error("Not enough shinsu to deploy this unit.");

    return true;
  }

  execute(data, gameState) {
    const { username, handId, placedPositionCode } = data;
    LifecycleEngine.deployUnit(gameState, username, handId, placedPositionCode);

    // Overflow deployments defer every gameplay mutation until the owner has
    // chosen the unit destroyed by the deployment. The card is still played
    // when it is chosen as that destroyed unit, so record it in either case.
    gameState.completeActionAfterDecision(() => {
      gameState.recordCardPlayed(username);
      gameState.endTurn();
    });
  }
}
