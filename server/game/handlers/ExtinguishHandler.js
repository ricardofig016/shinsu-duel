import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Extinguishes enemy lighthouses.
 *
 * Payload:
 *   { owner, amount }
 */
export default class ExtinguishHandler extends BaseHandler {
  validate(payload) {
    BaseHandler.requirePositiveInt(payload.amount, "amount");
    if (!payload.owner) {
      throw new Error("ExtinguishHandler: payload.owner is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;

    const oldAmount = gameState.playerStates[owner]?.lighthouses?.amount ?? 0;
    gameState.modifyLighthouses(owner, -amount);

    context.emitChild(EVT.LIGHTHOUSE_CHANGED, {
      owner,
      oldAmount,
      newAmount: gameState.playerStates[owner].lighthouses.amount,
      delta: gameState.playerStates[owner].lighthouses.amount - oldAmount,
    });

    if (gameState.playerStates[owner].lighthouses.amount <= 0) {
      context.emitChild(EVT.GAME_LIGHTHOUSES_DEPLETED, {
        owner,
        loser: owner,
        opponent: gameState.usernames.find((u) => u !== owner),
      });
    }

    return { extinguished: oldAmount - gameState.playerStates[owner].lighthouses.amount, current: gameState.playerStates[owner].lighthouses.amount, depleted: gameState.playerStates[owner].lighthouses.amount <= 0 };
  }
}
