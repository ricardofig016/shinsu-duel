import DebugAction from "./DebugAction.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";

/**
 * Put a unit from the compiled catalog onto a seat's field for free: no cost,
 * no combat slot, no turn change. Delegates to the summon path, so same-name
 * uniqueness, the five-unit line cap, and every deployment subscription
 * (traits, triggers, passives, attribute wiring) behave as they do for a
 * summoned unit. A full destination line opens the line-overflow decision.
 */
export default class DebugSpawnUnitAction extends DebugAction {
  static schema = {
    ...DebugAction.schema,
    username: "string",
    cardId: "number",
    positionCode: "string",
  };

  validate(data, gameState) {
    super.validate(data, gameState);
    this.targetPlayerState(data, gameState);

    const card = this.buildCard(data, gameState, data.username);
    if (card.type !== "unit") throw new Error(`Card ${data.cardId} is not a unit.`);

    // Standard units occupy one of their printed positions; special kinds
    // resolve their line from their own kind and ignore the code.
    if (card.kind === "standard" && !gameState.constructor.positions[data.positionCode]) {
      throw new Error(`Invalid position: ${data.positionCode}`);
    }
  }

  execute(data, gameState) {
    const card = this.buildCard(data, gameState, data.username);
    LifecycleEngine.summonUnit(gameState, data.username, card, data.positionCode);
  }
}
