import ActionHandler from "../ActionHandler.js";
import Unit from "../Unit.js";

/**
 * Deploy a unit from a player's hand to a specified position on the board.
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
    if (!gameState.positions[placedPositionCode])
      throw new Error(`Invalid placedPositionCode: ${placedPositionCode}`);

    const card = playerState.hand[handId];
    if (!card) throw new Error("Card not found in hand.");
    if (!(placedPositionCode in card.positions))
      throw new Error(`Card cannot be placed in position ${placedPositionCode}.`);

    if (card.cost > gameState.getTotalShinsu(username))
      throw new Error("Not enough shinsu to deploy this unit.");

    return true;
  }

  execute(data, gameState) {
    const { username, handId, placedPositionCode } = data;
    const player = gameState.playerStates[username];
    const [card] = player.hand.splice(handId, 1);

    const unit = new Unit(card, placedPositionCode);
    const line = player.field[gameState.positions[placedPositionCode].line];
    line.push(unit);

    gameState.spendShinsu(username, card.cost);

    gameState.eventBus.publish("OnDeployUnit", { username, unit });
    gameState.eventBus.publish("OnSummonUnit", { username, unit });
    unit.onSummon(gameState);
    gameState.endTurn();
  }
}
