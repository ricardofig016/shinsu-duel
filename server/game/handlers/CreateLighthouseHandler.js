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
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("CreateLighthouseHandler: payload.amount must be a positive number");
    }
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
