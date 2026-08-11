import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Creates (regains) lighthouses for a player.
 *
 * Payload:
 *   { owner, amount }
 */
export default class CreateLighthouseHandler extends BaseHandler {
  validate(payload) {
    BaseHandler.requirePositiveInt(payload.amount, "amount");
    if (!payload.owner) {
      throw new Error("CreateLighthouseHandler: payload.owner is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;

    const oldAmount = gameState.playerStates[owner]?.lighthouses?.amount ?? 0;
    gameState.modifyLighthouses(owner, amount);

    context.emitChild(EVT.LIGHTHOUSE_CHANGED, {
      owner,
      oldAmount,
      newAmount: gameState.playerStates[owner].lighthouses.amount,
      delta: gameState.playerStates[owner].lighthouses.amount - oldAmount,
    });

    return { created: gameState.playerStates[owner].lighthouses.amount - oldAmount, current: gameState.playerStates[owner].lighthouses.amount };
  }
}
