import BaseHandler from "./BaseHandler.js";
import EVT from "../EventCatalog.js";
import TargetResolver from "../TargetResolver.js";
import shuffle from "../utils/shuffle.js";
import { toCardTargetView } from "../utils/cardData.js";

/**
 * Reveals cards in a player's hand (observer-only — no state mutation).
 *
 * DSL type: peek_hand
 *
 * `owner` is the player whose hand is revealed (resolved to a username by
 * EffectResolver). An optional `card` filter narrows the eligible cards.
 * `mode` (`all` | `random` | `choose`) and `amount` select how many to reveal:
 *   - `all` (or bare): reveal every matching card.
 *   - `random` / `random: true` (default for a bare peek): reveal `amount`
 *     (default 1) seeded-random matching cards.
 *   - `choose`: the observer picks `amount` matching cards.
 *
 * The revealed cards are emitted via `hand:peeked` with no mutation.
 *
 * Payload:
 *   { owner, card?, mode?, amount?, random?, sourceOwner }
 */
export default class PeekHandHandler extends BaseHandler {
  validate(payload) {
    if (!payload.owner) throw new Error("PeekHandHandler: payload.owner is required");
  }

  execute(payload, context, gameState) {
    const { owner, card, mode, amount = 1, random, sourceOwner } = payload;
    const player = gameState.playerStates[owner];
    if (!player) return { revealed: [] };

    let hand = [...(player.hand || [])];
    if (card && typeof card === "object") {
      const view = hand.map(toCardTargetView).filter(Boolean);
      const matches = TargetResolver.resolveCardTargets(view, card);
      const matchIds = new Set(matches.map((c) => c.id));
      hand = hand.filter((c) => matchIds.has(c.id));
    }

    if (hand.length === 0) return { revealed: [] };

    const observer = sourceOwner || payload.sourceOwner || owner;
    const toView = (c) => ({ id: c.id, name: c.name, cost: c.cost, type: c.type });

    if (mode === "all") {
      const views = hand.map(toView);
      context.emitChild(EVT.HAND_PEEKED, { owner, observer, cards: views });
      return { revealed: views };
    }

    if (mode === "choose") {
      const count = Math.min(amount, hand.length);
      gameState.createPendingDecision({
        owner: observer,
        type: "card_selection",
        candidates: hand.map(toView),
        minChoices: count,
        maxChoices: count,
        resolve: (chosenIds) => {
          const chosen = hand.filter((c) => chosenIds.includes(c.id)).map(toView);
          context.emitChild(EVT.HAND_PEEKED, { owner, observer, cards: chosen });
        },
      });
      return { pending: true };
    }

    // random (default for a bare peek) — reveal `amount` matching cards.
    const count = Math.min(amount, hand.length);
    const views = shuffle(hand, gameState._rng).slice(0, count).map(toView);
    context.emitChild(EVT.HAND_PEEKED, { owner, observer, cards: views });
    return { revealed: views };
  }
}
