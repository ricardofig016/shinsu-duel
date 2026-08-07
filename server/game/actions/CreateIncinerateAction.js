import ActionHandler from "../ActionHandler.js";
import ZoneService from "../services/ZoneService.js";

/** Resolves Fire Core's highest-affordable Incinerate creation. */
export default class CreateIncinerateAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    if (!gameState.playerStates[data.username]) throw new Error(`Player ${data.username} not found.`);
    if (gameState.currentTurn !== data.username) throw new Error("It's not your turn.");

    const hasFireCore = gameState.playerStates[data.username].hand
      .some((card) => card.name === "Fire Core");
    if (!hasFireCore) throw new Error("Fire Core is required to create an Incinerate.");
  }

  execute(data, gameState) {
    const player = gameState.playerStates[data.username];
    const engine = gameState._attributeRegistry.get("hwayeomsa");
    const levels = engine.getAvailableLevels(data.username, gameState);
    if (levels.length === 0) throw new Error("Not enough Fire Charges to create an Incinerate.");
    const fireCoreIndex = player.hand.findIndex((card) => card.name === "Fire Core");
    const fireCore = ZoneService.removeFromHand(player, fireCoreIndex);
    const highest = levels.at(-1);
    engine.consumeCharges(data.username, highest.level, gameState);
    ZoneService.discard(player, fireCore);
  }
}
