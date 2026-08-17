import BaseHandler from "./BaseHandler.js";
import ZoneService from "../services/ZoneService.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";
import { findCardsByName, findCardsByFamily } from "../utils/cardData.js";

/**
 * Creates a card in the owner's hand from a compiled card-target descriptor.
 *
 * DSL type: create_card
 *
 * Two creation paths:
 *   - Plain — an exact card name (optionally filtered by `card.type`) creates
 *     that card and emits `card:created` (e.g. "create Shinwonryu in hand").
 *   - Resource-gated — a family whose cards carry a `generated_by` deck
 *     constraint is created by spending the named resource. `fire_charge`
 *     delegates to the Hwayeomsa engine, which picks the highest affordable
 *     Incinerate and consumes charges (RULES.md Hwayeomsa mechanic).
 *
 * `card.choose`/`card.random` selection is not yet supported (Phase D); the
 * effect is skipped with an unsupported-effect event.
 */
export default class CreateCardHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("CreateCardHandler: payload.owner is required");
    if (!payload.card || typeof payload.card !== "object") {
      throw new Error("CreateCardHandler: payload.card is required");
    }
    if (typeof payload.card.name !== "string" || payload.card.name.trim() === "") {
      throw new Error("CreateCardHandler: payload.card.name is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, card: target } = payload;

    // Choice/random selection lands in Phase D.
    if (target.choose === true || target.random === true) {
      gameState.eventBus.emit(EVT.EFFECT_UNSUPPORTED, {
        skipped: true,
        reason: "unsupported_effect",
        type: "create_card",
        raw: payload.raw,
        owner,
        sourceId: payload.sourceId || null,
        detail: "card.choose/random selection is not yet supported",
      });
      return { skipped: true, reason: "unsupported_effect" };
    }

    const cards = gameState.constructor.cards;
    let candidates = findCardsByName(cards, target.name, target.type);
    if (candidates.length === 0) {
      candidates = findCardsByFamily(cards, target.name, target.type);
    }
    if (candidates.length === 0) {
      return { created: false, reason: `No card matches "${target.name}"` };
    }

    const generatedBy = candidates[0].deckConstraints?.find((c) => c.type === "generated_by");
    if (generatedBy) {
      return this._createByResource(generatedBy.resource, owner, payload, context, gameState);
    }

    const card = new Card(candidates[0].cardId, candidates[0], owner, gameState.eventBus);
    ZoneService.addToHand(gameState.playerStates[owner], card);
    context.emitChild(EVT.CARD_CREATED, { owner, cardId: card.cardId, name: card.name });
    return { created: true, card, name: card.name };
  }

  _createByResource(resource, owner, payload, context, gameState) {
    if (resource !== "fire_charge") {
      gameState.eventBus.emit(EVT.EFFECT_UNSUPPORTED, {
        skipped: true,
        reason: "unsupported_effect",
        type: "create_card",
        raw: payload.raw,
        owner,
        sourceId: payload.sourceId || null,
        detail: `unknown generated_by resource "${resource}"`,
      });
      return { skipped: true, reason: "unsupported_effect" };
    }

    const engine = gameState._attributeRegistry.get("hwayeomsa");
    if (!engine) throw new Error("CreateCardHandler: Hwayeomsa engine not registered");

    const levels = engine.getAvailableLevels(owner, gameState);
    if (levels.length === 0) {
      context.emitChild(EVT.HWAYEOMSA_INCINERATE_CREATED, {
        username: owner,
        level: 0,
        chargesRemaining: gameState.playerStates[owner]?.fireCharges ?? 0,
        skipped: true,
        reason: "not enough fire charges",
      });
      return { created: false, reason: "Not enough Fire Charges to create an Incinerate." };
    }

    const highest = levels.at(-1);
    const incinerate = engine.consumeCharges(owner, highest.level, gameState);
    return { created: true, card: incinerate, level: highest.level, name: highest.name };
  }
}
