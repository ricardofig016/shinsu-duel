import BaseHandler from "./BaseHandler.js";

/**
 * Destroys enemy lighthouses.
 *
 * The game rule: a player loses when they reach 0 lighthouses.
 * This handler enforces the floor at 0 and emits the loss event
 * if the player's lighthouses are exhausted.
 *
 * Payload:
 *   { owner, amount }
 *
 * Emits children:
 *   - state:lighthouse:changed  (on every destruction)
 *   - game:lighthouses:depleted  (when lighthouses reach 0)
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
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const oldAmount = player.lighthouses.amount;
    const newAmount = Math.max(oldAmount - amount, 0);
    const actualLoss = oldAmount - newAmount;

    player.lighthouses.amount = newAmount;

    context.emitChild("state:lighthouse:changed", {
      owner,
      oldAmount,
      newAmount,
      delta: -actualLoss,
    });

    // Loss condition: lighthouses reach 0
    // Phase 2 will wire this event to game-over logic
    if (newAmount <= 0) {
      context.emitChild("game:lighthouses:depleted", {
        owner,
        opponent: gameState.usernames.find((u) => u !== owner),
      });
    }

    return { destroyed: actualLoss, current: newAmount, depleted: newAmount <= 0 };
  }
}
