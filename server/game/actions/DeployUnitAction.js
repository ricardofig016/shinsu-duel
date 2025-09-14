import ActionHandler from "./ActionHandler.js";
import Unit from "../Unit.js";

export default class DeployUnitAction extends ActionHandler {
  validate(data) {
    const { username, handId, placedPositionCode } = data;
    const player = this.gameState.playerStates[username];

    if (!player) throw new Error(`Player ${username} not found.`);
    if (handId < 0 || handId >= player.hand.length) throw new Error("Invalid handId.");
    if (!this.gameState.positions[placedPositionCode]) {
      throw new Error(`Invalid placedPositionCode: ${placedPositionCode}`);
    }

    const card = player.hand[handId];
    if (!card) throw new Error("Card not found in hand.");
    if (!this.gameState.cards[card.id].positionCodes.includes(placedPositionCode)) {
      throw new Error(`Card cannot be placed in position ${placedPositionCode}.`);
    }

    const totalShinsu = player.shinsu.normalAvailable + player.shinsu.recharged;
    if (this.gameState.cards[card.id].cost > totalShinsu) {
      throw new Error("Not enough shinsu to deploy this unit.");
    }
  }

  execute(data) {
    const { username, handId, placedPositionCode } = data;
    const player = this.gameState.playerStates[username];
    const [card] = player.hand.splice(handId, 1);

    const unit = new Unit(
      card.id,
      this.gameState.cards[card.id],
      username,
      placedPositionCode,
      this.gameState.eventBus
    );
    const line = player.field[this.gameState.positions[placedPositionCode].line];
    line.push(unit);

    this.gameState.#spendShinsu(username, this.gameState.cards[card.id].cost);

    this.gameState.eventBus.publish("OnDeployUnit", { username, unit });
    this.gameState.eventBus.publish("OnSummonUnit", { username, unit });
    this.gameState.#endTurn();
  }
}
