import BaseHandler from "./BaseHandler.js";
import Card from "../Card.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import ZoneService from "../services/ZoneService.js";
import TargetResolver from "../TargetResolver.js";
import shuffle from "../utils/shuffle.js";
import { toCardTargetView } from "../utils/cardData.js";

/**
 * Summons a unit onto a battlefield without paying its cost, spending a
 * combat slot, or ending the turn.
 *
 * DSL type: summon
 *
 * `from` selects the source zone (deck | hand | deck_or_hand | game) and
 * `onto` the destination (self | opponent | both). The card is resolved via
 * `TargetResolver.resolveCardTargets`; `random` picks deterministically via
 * the seeded RNG. A multi-position card defers position choice to a
 * `position_selection` decision; a single-position card is placed directly.
 *
 * Payload:
 *   { owner, card, from, onto, sourceId, sourceUnit }
 */
export default class SummonHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("SummonHandler: payload.owner is required");
    if (!payload.card || typeof payload.card !== "object") {
      throw new Error("SummonHandler: payload.card is required");
    }
    if (!payload.from) throw new Error("SummonHandler: payload.from is required");
    if (!payload.onto) throw new Error("SummonHandler: payload.onto is required");
  }

  execute(payload, context, gameState) {
    const acting = payload.owner;
    const opponent = gameState.usernames.find((u) => u !== acting);
    const destinations = payload.onto === "both" ? [acting, opponent]
      : payload.onto === "opponent" ? [opponent]
      : [acting];

    const results = [];
    for (const destOwner of destinations) {
      const card = this._resolveSourceCard(destOwner, payload, gameState);
      if (!card) {
        results.push({ summoned: false, reason: "no matching card" });
        continue;
      }
      results.push(this._place(destOwner, card, payload, gameState));
    }
    return { summoned: results.some((r) => r.summoned), results };
  }

  _resolveSourceCard(owner, payload, gameState) {
    const { card: descriptor, from } = payload;
    const acting = payload.owner;

    if (from === "game") {
      const view = Object.values(gameState.constructor.cards).map(toCardTargetView).filter(Boolean);
      const matches = TargetResolver.resolveCardTargets(view, descriptor);
      if (matches.length === 0) return null;
      const chosen = descriptor.random ? shuffle(matches, gameState._rng)[0] : matches[0];
      const data = gameState.constructor.cards[chosen.cardId];
      return new Card(chosen.cardId, data, owner, gameState.eventBus);
    }

    const player = gameState.playerStates[acting];
    const zones = from === "deck" ? ["deck"] : from === "hand" ? ["hand"] : ["hand", "deck"];
    for (const zone of zones) {
      const view = (player[zone] || []).map(toCardTargetView).filter(Boolean);
      const matches = TargetResolver.resolveCardTargets(view, descriptor);
      if (matches.length === 0) continue;
      const chosen = descriptor.random ? shuffle(matches, gameState._rng)[0] : matches[0];
      const card = zone === "hand"
        ? ZoneService.removeFromHandById(player, chosen.id)
        : ZoneService.removeFromDeckById(player, chosen.id);
      if (card) {
        card.owner = owner;
        return card;
      }
    }
    return null;
  }

  _place(owner, card, payload, gameState) {
    const positions = Object.keys(card.positions || {});
    if (positions.length === 0) return { summoned: false, reason: "no position" };

    if (positions.length === 1) {
      const result = LifecycleEngine.summonUnit(gameState, owner, card, positions[0]);
      return {
        summoned: result.unit !== null || result.discardedDuplicate === true,
        discardedDuplicate: result.discardedDuplicate === true,
        pending: false,
      };
    }

    gameState.createPendingDecision({
      owner: payload.owner,
      type: "position_selection",
      candidates: positions.map((p) => ({
        id: p,
        name: gameState.constructor.positions[p]?.name || p,
        hp: 0,
      })),
      minChoices: 1,
      maxChoices: 1,
      resolve: ([positionCode]) => {
        LifecycleEngine.summonUnit(gameState, owner, card, positionCode);
      },
    });
    return { summoned: true, pending: true };
  }
}
