import ActionHandler from "../../ActionHandler.js";
import Card from "../../Card.js";

/**
 * Base class for the dev console's mutation actions.
 *
 * A debug action is an ordinary engine action: it runs through
 * `GameState.processAction`, so it bumps the session revision, broadcasts the
 * resulting state, and reaches the Logger and the replay stream exactly like a
 * player action. Two things set it apart from a player action:
 *
 *  - **Source.** `sourceAccess` admits `source: "debug"` only. The gateway
 *    stamps that source on messages that arrive over `debug-action`, so a
 *    player-stamped payload can never reach these mutations, and a
 *    debug-stamped payload can never reach a player action.
 *  - **Identity.** `username` is the seat the command acts on, and
 *    `requestedBy` is the player who issued it. In a dev room both seats may
 *    command either seat, so a replay artifact must record both.
 *
 * Subclasses declare the arguments they take on top of the base schema and
 * delegate every mutation to the owning service.
 */
export default class DebugAction extends ActionHandler {
  static schema = {
    source: "string",
    requestedBy: "string",
  };
  static sourceAccess = { player: false, debug: true, system: false };

  /**
   * Validate that a value is an integer within a range.
   *
   * @param {number} value
   * @param {string} label
   * @param {{ min?: number, max?: number }} [bounds]
   * @returns {number}
   */
  static requireInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${label} must be an integer between ${min} and ${max}, got ${value}`);
    }
    return value;
  }

  /** The player state of the seat this command acts on. */
  targetPlayerState(data, gameState) {
    const player = gameState.playerStates[data.username];
    if (!player) throw new Error(`Player ${data.username} not found.`);
    return player;
  }

  /** The deployed unit a unit-scoped command acts on. */
  targetUnit(data, gameState) {
    const unit = gameState._findUnit(data.unitId);
    if (!unit) throw new Error(`Unit ${data.unitId} is not on the field.`);
    return unit;
  }

  /** Build a card instance from the game's compiled catalog. */
  buildCard(data, gameState, owner) {
    const cardData = gameState.cards[data.cardId];
    if (cardData === undefined) throw new Error(`Card ${data.cardId} does not exist.`);
    return new Card(data.cardId, cardData, owner, gameState.eventBus);
  }
}
