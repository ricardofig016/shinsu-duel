import BaseHandler from "./BaseHandler.js";
import { resolveEffect } from "../EffectResolver.js";

/**
 * Uses a copy of an enemy unit's ability.
 *
 * DSL type: copy_ability
 *
 * EffectResolver resolves the `source` descriptor into `sourceUnitId` (a
 * concrete enemy unit). This handler then resolves one of that unit's active
 * abilities — directly when there is exactly one, or via an
 * `ability_selection` decision otherwise. The copied ability resolves with
 * the caster as its source; it neither spends a combat slot nor ends the turn
 * (the wrapping `spend_shinsu` ability governs those).
 *
 * Payload:
 *   { sourceUnitId, sourceId, sourceUnit, sourceOwner }
 */
export default class CopyAbilityHandler extends BaseHandler {
  validate(payload) {
    if (!payload.sourceUnitId) throw new Error("CopyAbilityHandler: payload.sourceUnitId is required");
  }

  execute(payload, context, gameState) {
    const { sourceUnitId, sourceId, sourceUnit, sourceOwner } = payload;
    const source = gameState._findUnit(sourceUnitId);
    if (!source || !source.isAlive()) return { used: false };

    const abilities = source.card?.abilities || [];
    if (abilities.length === 0) return { used: false, reason: "no abilities" };

    const caster = sourceUnit || gameState._findUnit(sourceId);
    const owner = sourceOwner || caster?.owner;

    const use = (ability) => {
      resolveEffect(ability, context, gameState, {
        owner,
        sourceId,
        sourceUnit: caster,
        sourceOwner: owner,
        targetOwner: gameState.usernames.find((u) => u !== owner),
      });
    };

    if (abilities.length === 1) {
      use(abilities[0]);
      return { used: true };
    }

    gameState.createPendingDecision({
      owner,
      type: "ability_selection",
      candidates: abilities.map((a, i) => ({
        id: String(i),
        name: a.raw || a.type,
        hp: 0,
      })),
      minChoices: 1,
      maxChoices: 1,
      resolve: ([idx]) => use(abilities[Number(idx)]),
    });
    return { used: true, pending: true };
  }
}
