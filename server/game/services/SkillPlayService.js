import { resolveEffects } from "../EffectResolver.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";

/**
 * Announce-and-resolve segment shared by every skill play.
 *
 * One definition of "play a skill": emit `SKILL_APPLIED` as
 * `{ owner, cardName, card }`, then resolve the card's effect nodes with the
 * caller's `extra`. The player path (`PlaySkillAction`) and synthetic plays
 * (`PlayJeonsulBaangHandler`) both delegate here, so every `SKILL_APPLIED`
 * subscriber sees the same payload shape regardless of who played the card.
 *
 * Static service in the `UnitService`/`ZoneService` style. The EffectResolver
 * import is circular (resolver → handler → this service) and safe because
 * resolution runs at call time, mirroring PassiveManager.
 */
export default class SkillPlayService {
  /**
   * Announce a skill play, then resolve its effects.
   *
   * @param {import('../GameState.js').default} gameState
   * @param {object} context — EventBus EventContext (announce goes out via emitChild)
   * @param {object} request
   * @param {Card} request.card — the played card instance
   * @param {Array<object>} [request.effects] — effect nodes to resolve; defaults to `card.effects`
   * @param {string} request.owner — username of the playing (or owning) player
   * @param {object} [request.extra] — extra payload merged into each resolved effect
   * @returns {*} resolveEffects result
   */
  static play(gameState, context, request) {
    const { card, effects, owner, extra } = request || {};
    if (!(card instanceof Card)) {
      throw new Error("SkillPlayService: request.card must be a Card instance");
    }
    if (!owner) throw new Error("SkillPlayService: request.owner is required");

    context.emitChild(EVT.SKILL_APPLIED, { owner, cardName: card.name, card });
    return resolveEffects(effects ?? card.effects, context, gameState, extra);
  }
}
