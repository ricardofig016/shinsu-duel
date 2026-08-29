import BaseHandler from "./BaseHandler.js";
import SkillPlayService from "../services/SkillPlayService.js";
import Card from "../Card.js";
import { findCardsByKeyword } from "../utils/cardData.js";
import shuffle from "../utils/shuffle.js";

/**
 * Plays the Conduit's Jeonsul Baangs: one random Baang onto a random other
 * friendly unit for every 2 current HP the Conduit has.
 *
 * DSL type: play_jeonsul_baang
 *
 * The payload is the whole passive node merged with the trigger's resolution
 * extra, so `sourceUnit` (set by PassiveManager._triggerExtra) is the Conduit.
 *
 * Plays are synthetic: each one announces `SKILL_APPLIED` through
 * `SkillPlayService` — full play visibility, including `skill_played`
 * synergies — but pays no cost, touches no hand, discards nothing, ends no
 * turn, consumes no repeat queues, and never calls `recordCardPlayed`. Those
 * belong to the player action layer, and the round-start play tracker must
 * not count passive plays. The played Baang is a transient `Card` instance
 * (the constructor is pure data mapping), pinned to the chosen ally via
 * `extra.targetId`, which overrides the Baang's authored target descriptor.
 */
export default class PlayJeonsulBaangHandler extends BaseHandler {
  validate(payload) {
    if (!payload.sourceUnit) {
      throw new Error("PlayJeonsulBaangHandler: payload.sourceUnit is required");
    }
  }

  execute(payload, context, gameState) {
    const conduit = payload.sourceUnit;
    const count = Math.floor(conduit.currentHp / 2);
    const baangs = findCardsByKeyword(gameState.cards, "jeonsul-baang", "skill");
    if (count <= 0 || baangs.length === 0) return { played: 0, skipped: 0 };

    const allies = this._allies(gameState, conduit);
    let played = 0;
    let skipped = 0;

    for (let i = 0; i < count; i++) {
      if (allies.length === 0) {
        skipped++;
        continue;
      }
      const ally = shuffle(allies, gameState._rng)[0];
      const baangData = shuffle(baangs, gameState._rng)[0];
      const card = new Card(baangData.cardId, baangData, conduit.owner, gameState.eventBus);
      SkillPlayService.play(gameState, context, {
        card,
        owner: conduit.owner,
        extra: {
          owner: conduit.owner,
          sourceId: payload.sourceId,
          sourceType: "passive",
          sourceUnit: conduit,
          targetId: ally.id,
        },
      });
      played++;
    }

    return { played, skipped };
  }

  /**
   * Friendly units of the Conduit's owner, excluding the Conduit itself —
   * the Baangs must not target their source.
   */
  _allies(gameState, conduit) {
    const field = gameState.playerStates[conduit.owner]?.field;
    if (!field) return [];
    return [...(field.frontline || []), ...(field.backline || [])]
      .filter((unit) => unit !== conduit);
  }
}
