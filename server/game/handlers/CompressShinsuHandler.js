import BaseHandler from "./BaseHandler.js";

/**
 * Reduces the shinsu cost of the next card played this turn.
 *
 * Payload:
 *   { owner, amount }
 *
 * The compression amount is stored on the player state and cleared
 * at turn end via the "turn:ended" event.
 */
export default class CompressShinsuHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("CompressShinsuHandler: payload.owner is required");
    if (typeof payload.amount !== "number" || payload.amount <= 0) {
      throw new Error("CompressShinsuHandler: payload.amount must be a positive number");
    }
  }

  execute(payload, context, gameState) {
    const { owner, amount } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    // Initialize compress field if absent
    if (typeof player.compressAmount !== "number") {
      player.compressAmount = 0;
    }

    player.compressAmount += amount;

    context.emitChild("shinsu:compressed", {
      owner,
      amount,
      totalCompression: player.compressAmount,
    });

    return { compressed: amount, totalCompression: player.compressAmount };
  }
}
