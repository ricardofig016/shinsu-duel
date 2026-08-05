import BaseHandler from "./BaseHandler.js";

/**
 * Adds shinsu to the player's normal pool (not recharged).
 *
 * Payload:
 *   { owner, amount }
 *
 * Shinsu is capped at the round maximum per RULES.md §Resources.
 * amount must be a positive integer.
 */
export default class ChargeShinsuHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("ChargeShinsuHandler: payload.owner is required");
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("ChargeShinsuHandler: payload.amount must be a positive number");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const maxShinsu = Math.min(10, gameState.round);
    const before = player.shinsu.normalAvailable;

    // Add to normal pool only, capped at round maximum
    player.shinsu.normalAvailable = Math.min(maxShinsu, player.shinsu.normalAvailable + amount);
    const gained = player.shinsu.normalAvailable - before;

    context.emitChild("shinsu:charged", {
      owner,
      amount: gained,
      total: player.shinsu.normalAvailable + player.shinsu.recharged,
    });

    return { gained };
  }
}
