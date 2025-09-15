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

  validate(data) {
    super.validate(data);
    const { username, handId, placedPositionCode } = data;
    const playerState = this.gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (this.gameState.currentTurn !== username) throw new Error("It's not your turn.");

    if (handId < 0 || handId >= playerState.hand.length) throw new Error("Invalid handId.");
    if (!this.gameState.positions[placedPositionCode])
      throw new Error(`Invalid placedPositionCode: ${placedPositionCode}`);

    const card = playerState.hand[handId];
    if (!card) throw new Error("Card not found in hand.");
    if (!this.gameState.cards[card.id].positionCodes.includes(placedPositionCode))
      throw new Error(`Card cannot be placed in position ${placedPositionCode}.`);

    if (this.gameState.cards[card.id].cost > this.gameState.getTotalShinsu(username))
      throw new Error("Not enough shinsu to deploy this unit.");

    return true;
  }

  execute(data) {
    const { username, handId, placedPositionCode } = data;
    const player = this.gameState.playerStates[username];
    const [card] = player.hand.splice(handId, 1);

    const unit = new Unit(
      this.gameState,
      card.id,
      this.gameState.cards[card.id],
      username,
      placedPositionCode,
      this.gameState.eventBus
    );
    const line = player.field[this.gameState.positions[placedPositionCode].line];
    line.push(unit);

    this.gameState.spendShinsu(username, this.gameState.cards[card.id].cost);

    this.gameState.eventBus.publish("OnDeployUnit", { username, unit });
    this.gameState.eventBus.publish("OnSummonUnit", { username, unit });
    this.gameState.endTurn();
  }
}
