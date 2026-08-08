import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";

/**
 * Destroys enemy lighthouses.
 *
 * Payload:
 *   { owner, amount }
 */
export default class DestroyLighthouseHandler extends BaseHandler {
  validate(payload) {
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("DestroyLighthouseHandler: payload.amount must be a positive number");
    }
    if (!payload.owner) {
      throw new Error("DestroyLighthouseHandler: payload.owner is required");
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

    return { destroyed: oldAmount - gameState.playerStates[owner].lighthouses.amount, current: gameState.playerStates[owner].lighthouses.amount, depleted: gameState.playerStates[owner].lighthouses.amount <= 0 };
  }
}
