import BaseHandler from "./BaseHandler.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import TargetResolver from "../TargetResolver.js";
import shuffle from "../utils/shuffle.js";

/**
 * Steals a deployed enemy unit, reassigning it onto the acting player's board
 * at a legal position taken from its printed positions.
 *
 * DSL type: steal
 *
 * The `card` descriptor filters the enemy field (position/cost/rank/
 * affiliation/attribute/name). `cost: cheapest` keeps the lowest-cost match;
 * ties resolve deterministically to the first in field order. `random` picks
 * via the seeded RNG; `choose` defers to a target_selection decision.
 *
 * Payload:
 *   { owner, card, sourceId, sourceUnit }
 */
export default class StealHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("StealHandler: payload.owner is required");
    if (!payload.card || typeof payload.card !== "object") {
      throw new Error("StealHandler: payload.card is required");
    }
  }

  execute(payload, context, gameState) {
    const acting = payload.owner;
    const descriptor = payload.card;

    const candidates = TargetResolver.resolveExistenceUnits(gameState, {
      side: "enemy",
      position: descriptor.position,
      cost: descriptor.cost,
      rank: descriptor.rank,
      affiliation: descriptor.affiliation,
      attribute: descriptor.attribute,
      name: descriptor.name,
    }, acting);

    if (candidates.length === 0) return { stolen: false, reason: "no valid target" };

    if (descriptor.choose && candidates.length > 1) {
      gameState.createPendingDecision({
        owner: acting,
        type: "target_selection",
        candidates: candidates.map((u) => ({ id: u.id, name: u.card.name, hp: u.currentHp })),
        minChoices: 1,
        maxChoices: 1,
        resolve: ([id]) => {
          const unit = gameState._findUnit(id);
          const positionCode = this._autoPosition(unit, acting, gameState);
          if (unit && positionCode) LifecycleEngine.stealUnit(gameState, unit, acting, positionCode);
        },
      });
      return { stolen: true, pending: true };
    }

    const target = descriptor.random ? shuffle(candidates, gameState._rng)[0] : candidates[0];
    const positionCode = this._autoPosition(target, acting, gameState);
    if (!positionCode) return { stolen: false, reason: "no legal position" };

    const result = LifecycleEngine.stealUnit(gameState, target, acting, positionCode);
    return { stolen: result.stolen, pending: result.pending === true };
  }

  _autoPosition(unit, newOwner, gameState) {
    const positions = Object.keys(unit.card.positions || {});
    for (const pos of positions) {
      const line = gameState.constructor.positions[pos]?.line;
      if (line && gameState.playerStates[newOwner].field[line].length < 5) return pos;
    }
    // Every printed position leads to a full line: pick the first and let
    // stealUnit's overflow decision resolve the conflict.
    return positions[0] || null;
  }
}
