import BaseHandler from "./BaseHandler.js";
import ShinsuService from "../services/ShinsuService.js";
import EVT from "../EventCatalog.js";

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

    const beforeNormal = player.shinsu.normalAvailable;
    const beforeRecharged = player.shinsu.recharged;

    // Delegate to authoritative ShinsuService
    ShinsuService.spend(player, amount);

    context.emitChild(EVT.SHINSU_CHANGED, {
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
