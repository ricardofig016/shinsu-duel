import BaseHandler from "./BaseHandler.js";
import CompressionService from "../services/CompressionService.js";

/**
 * Reduces the shinsu cost of one card instance in its owner's hand.
 *
 * Payload:
 *   { owner, amount, targetCardId }
 *
 * The `targetCardId` is always pre-resolved by EffectResolver/TargetResolver
 * from the compiled `targetCardSelector`. Handlers never interpret target
 * descriptors themselves.
 *
 * Delegates to the authoritative CompressionService for mutation.
 */
export default class CompressShinsuHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("CompressShinsuHandler: payload.owner is required");
    if (!payload.targetCardId) throw new Error("CompressShinsuHandler: payload.targetCardId is required");
    BaseHandler.requirePositiveInt(payload.amount, "amount");
  }

  execute(payload, context, gameState) {
    const { owner, amount, targetCardId } = payload;
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);

    const target = player.hand.find((card) => card.id === targetCardId);
    if (!target) {
      throw new Error("CompressShinsuHandler: the target card is no longer in the owner's hand");
    }

    // Delegate to authoritative CompressionService
    return CompressionService.compress(target, amount, context);
  }
}
