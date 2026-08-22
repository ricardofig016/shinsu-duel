import BaseHandler from "./BaseHandler.js";

/**
 * Queues extra plays of a card ("the next time you play X, play it N more
 * times").
 *
 * DSL type: repeat_play
 *
 * Registers a turn-scoped pending repeat on GameState. When the player next
 * plays a card named `cardName`, its effects resolve `amount` additional
 * times (consumed by PlaySkillAction / DeployUnitAction). When `cardName` is
 * omitted, the repeat is a wildcard — the next card the player plays is
 * replayed (e.g. "the next card you play, play it again").
 *
 * Payload:
 *   { owner, cardName?, amount }
 */
export default class RepeatPlayHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("RepeatPlayHandler: payload.owner is required");
    BaseHandler.requirePositiveInt(payload.amount, "amount");
  }

  execute(payload, context, gameState) {
    const { owner, cardName, amount } = payload;
    gameState.queueRepeatPlay(owner, cardName, amount);
    return { queued: true, cardName, amount };
  }
}
