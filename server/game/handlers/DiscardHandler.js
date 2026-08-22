import BaseHandler from "./BaseHandler.js";
import ZoneService from "../services/ZoneService.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import EVT from "../EventCatalog.js";

/**
 * Sends a card to the discard pile.
 *
 * DSL type: discard
 *
 * Two destinations:
 *   - `zone: attachments` (default hand for `discard`) — discard one or more
 *     cards attached to the source unit (bearer attachments). EffectResolver
 *     pre-resolves the matching attachment ids into `payload.attachmentIds`.
 *   - hand — discard a specific card instance pre-resolved into
 *     `payload.targetCardId` (e.g. "opponent discards a Regular of your
 *     choice").
 *
 * Payload:
 *   { owner, card, targetCardId?, attachmentIds?, sourceId, sourceUnit }
 */
export default class DiscardHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("DiscardHandler: payload.owner is required");
    if (!payload.card || typeof payload.card !== "object") {
      throw new Error("DiscardHandler: payload.card is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, card } = payload;
    const player = gameState.playerStates[owner];

    if (card.zone === "attachments") {
      const unit = payload.sourceUnit || gameState._findUnit(payload.sourceId);
      const ids = payload.attachmentIds || [];
      let discarded = 0;
      for (const id of ids) {
        const attachment = (unit?.equipmentAttachments || []).find((c) => c.id === id);
        if (attachment) {
          LifecycleEngine.discardEquipment(gameState, unit, attachment);
          discarded++;
        }
      }
      if (discarded > 0) {
        context.emitChild(EVT.CARD_DISCARDED, { owner, count: discarded, zone: "attachments" });
      }
      return { discarded };
    }

    const targetCardId = payload.targetCardId;
    if (!targetCardId) return { discarded: 0 };

    const cardInstance = ZoneService.removeFromHandById(player, targetCardId);
    if (!cardInstance) return { discarded: 0 };

    ZoneService.discard(player, cardInstance);
    context.emitChild(EVT.CARD_DISCARDED, {
      owner,
      cardId: cardInstance.cardId,
      name: cardInstance.name,
    });
    return { discarded: 1, card: cardInstance };
  }
}
