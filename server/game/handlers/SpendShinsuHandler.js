import BaseHandler from "./BaseHandler.js";

/**
 * Validates and deducts shinsu from a player.
 *
 * Payload:
 *   { owner, amount }
 */
export default class SpendShinsuHandler extends BaseHandler {
  validate(payload) {
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("SpendShinsuHandler: payload.amount must be a positive number");
    }
    if (!payload.owner) {
      throw new Error("SpendShinsuHandler: payload.owner is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const total = player.shinsu.normalAvailable + player.shinsu.recharged;
    if (total < amount) {
      throw new Error(`Player "${owner}" has insufficient shinsu (need ${amount}, have ${total})`);
    }

    const beforeNormal = player.shinsu.normalAvailable;
    const beforeRecharged = player.shinsu.recharged;

    // Deduct from recharged first, then normal
    const fromRecharged = Math.min(player.shinsu.recharged, amount);
    player.shinsu.recharged -= fromRecharged;
    player.shinsu.normalAvailable -= (amount - fromRecharged);
    player.shinsu.normalSpent += (amount - fromRecharged);

    context.emitChild("state:shinsu:changed", {
      owner,
      before: { normal: beforeNormal, recharged: beforeRecharged },
      after: {
        normal: player.shinsu.normalAvailable,
        recharged: player.shinsu.recharged,
      },
      spent: amount,
    });

    return { spent: amount };
  }
}
