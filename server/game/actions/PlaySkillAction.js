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
    RequirementValidator.validate(card.requirements, { gameState, card });
  }

  execute(data, gameState) {
    const player = gameState.playerStates[data.username];
    const card = ZoneService.removeFromHand(player, data.handId);
    const cost = Math.max(0, card.cost - (card.costReduction || 0));
    ShinsuService.spend(player, cost);

    gameState.eventBus.emit(EVT.SKILL_APPLIED, { owner: data.username, cardName: card.name, card });
    const effectContext = {
      emitChild: (eventName, payload) => gameState.eventBus.emit(eventName, payload),
    };
    resolveEffects(card.effects, effectContext, gameState, {
      owner: data.username,
      sourceId: card.id,
      sourceOwner: data.username,
      targetOwner: gameState.usernames.find((username) => username !== data.username),
    });
    gameState.completeActionAfterDecision(() => {
      ZoneService.discard(player, card);
      gameState.endTurn();
    });
  }
}
