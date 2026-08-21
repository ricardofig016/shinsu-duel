import BaseHandler from "./BaseHandler.js";
import ZoneService from "../services/ZoneService.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";
import shuffle from "../utils/shuffle.js";
import { findCardsByName, findCardsBySeries } from "../utils/cardData.js";

/**
 * Creates a card in the owner's hand from a compiled card-target descriptor.
 *
 * DSL type: create_card
 *
 * Two creation paths:
 *   - Plain — an exact card name or a card `series` (optionally filtered by
 *     `card.type`) creates that card and emits `card:created` (e.g. "create
 *     Shinwonryu in hand", "create a Thorn Fragment of your choice").
 *   - Resource-gated — a card whose definition carries a `generated_by` deck
 *     constraint is created by spending the named resource. `fire_charge`
 *     delegates to the Hwayeomsa engine, which picks the highest affordable
 *     Incinerate and consumes charges (RULES.md Hwayeomsa mechanic).
 *
 * `card.choose`/`card.random` select among the matched catalog cards (plain
 * cards only — resource-gated cards always route through the engine).
 * `random` picks deterministically via the seeded RNG; `choose` defers to a
 * `card_selection` pending decision.
 */
export default class CreateCardHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("CreateCardHandler: payload.owner is required");
    if (!payload.card || typeof payload.card !== "object") {
      throw new Error("CreateCardHandler: payload.card is required");
    }
    const hasName = typeof payload.card.name === "string" && payload.card.name.trim() !== "";
    const hasSeries = typeof payload.card.series === "string" && payload.card.series.trim() !== "";
    if (!hasName && !hasSeries) {
      throw new Error("CreateCardHandler: payload.card.name or payload.card.series is required");
    }
  }

  execute(payload, context, gameState) {
    const { owner, card: target } = payload;

    const cards = gameState.constructor.cards;
    let candidates = target.series
      ? findCardsBySeries(cards, target.series, target.type)
      : findCardsByName(cards, target.name, target.type);
    if (candidates.length === 0) {
      const ref = target.series || target.name;
      return { created: false, reason: `No card matches "${ref}"` };
    }

    const generatedBy = candidates[0].deckConstraints?.find((c) => c.type === "generated_by");
    if (generatedBy) {
      return this._createByResource(generatedBy.resource, owner, payload, context, gameState);
    }

    // Choice / random selection among the matched plain cards.
    if (target.choose === true || target.random === true) {
      return this._createSelected(candidates, target, owner, payload, context, gameState);
    }

    return this._createCard(candidates[0], owner, context, gameState);
  }

  _createSelected(candidates, target, owner, payload, context, gameState) {
    let selected = null;

    if (target.random === true) {
      shuffle(candidates, gameState._rng);
      selected = candidates[0];
    } else if (target.choose === true) {
      if (candidates.length === 1) {
        selected = candidates[0];
      } else {
        gameState.createPendingDecision({
          owner,
          type: "card_selection",
          candidates: candidates.map((c) => ({ id: String(c.cardId), name: c.name, cost: c.cost, type: c.type })),
          minChoices: 1,
          maxChoices: 1,
          resolve: ([cardId]) => {
            const chosen = candidates.find((c) => String(c.cardId) === cardId);
            this._createCard(chosen, owner, context, gameState);
          },
        });
        return { pending: true };
      }
    }

    return this._createCard(selected, owner, context, gameState);
  }

  _createCard(cardData, owner, context, gameState) {
    const card = new Card(cardData.cardId, cardData, owner, gameState.eventBus);
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
