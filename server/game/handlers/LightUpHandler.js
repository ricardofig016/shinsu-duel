import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Lights up (regains) lighthouses for a player.
 *
 * Payload:
 *   { owner, amount }
 */
export default class LightUpHandler extends BaseHandler {
  validate(payload) {
    BaseHandler.requirePositiveInt(payload.amount, "amount");
    if (!payload.owner) {
      throw new Error("LightUpHandler: payload.owner is required");
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

    return { litUp: gameState.playerStates[owner].lighthouses.amount - oldAmount, current: gameState.playerStates[owner].lighthouses.amount };
  }
}
