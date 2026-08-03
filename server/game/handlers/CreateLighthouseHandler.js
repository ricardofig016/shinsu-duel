import BaseHandler from "./BaseHandler.js";

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
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const oldAmount = player.lighthouses.amount;
    const newAmount = Math.min(oldAmount + amount, 40); // max 40
    const actualGain = newAmount - oldAmount;

    player.lighthouses.amount = newAmount;

    context.emitChild("state:lighthouse:changed", {
      owner,
      oldAmount,
      newAmount,
      delta: actualGain,
    });

    return { created: actualGain, current: newAmount };
  }
}
