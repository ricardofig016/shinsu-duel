import ActionHandler from "../ActionHandler.js";
import ZoneService from "../services/ZoneService.js";
import ShinsuService from "../services/ShinsuService.js";
import RequirementValidator from "../services/RequirementValidator.js";
import EVT from "../EventCatalog.js";
import { resolveEffects } from "../EffectResolver.js";

/** Plays a one-shot skill through the DSL effect resolver. */
export default class PlaySkillAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    handId: "number",
  };
  static sourceAccess = { player: true, system: false };

  validate(data, gameState) {
    super.validate(data);
    const player = gameState.playerStates[data.username];
    if (!player) throw new Error(`Player ${data.username} not found.`);
    if (gameState.currentTurn !== data.username) throw new Error("It's not your turn.");
    const card = player.hand[data.handId];
    if (!card || card.type !== "skill") throw new Error("Card is not a skill or not in hand.");
    if (!ShinsuService.canAfford(player, Math.max(0, card.cost - (card.costReduction || 0)))) {
      throw new Error("Not enough shinsu to play this skill.");
    }
    RequirementValidator.validate(card.requirements, { gameState, username: data.username, card });
  }

  execute(data, gameState) {
    const player = gameState.playerStates[data.username];
    const card = ZoneService.removeFromHand(player, data.handId);
    const cost = Math.max(0, card.cost - (card.costReduction || 0));
    ShinsuService.spend(player, cost);
    gameState.recordCardPlayed(data.username);

    gameState.eventBus.emit(EVT.SKILL_APPLIED, { owner: data.username, cardName: card.name, card });
    const effectContext = {
      emitChild: (eventName, payload) => gameState.eventBus.emit(eventName, payload),
    };
    const extra = {
      owner: data.username,
      sourceId: card.id,
      sourceOwner: data.username,
      targetOwner: gameState.usernames.find((username) => username !== data.username),
    };

    // repeat_play: "the next time you play X, play it N more times". Consume the
    // queued repeats and resolve the skill's effects that many additional times,
    // flattened into one ordered effect list so pending-decision deferral stays
    // uniform across the original play and every repeat.
    const repeats = gameState.consumeRepeatPlays(data.username, card.name);
    const totalEffects = [];
    for (let i = 0; i < 1 + repeats; i++) totalEffects.push(...card.effects);

    resolveEffects(totalEffects, effectContext, gameState, extra);
    gameState.completeActionAfterDecision(() => {
      ZoneService.discard(player, card);
      gameState.endTurn();
    });
  }
}
