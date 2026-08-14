/**
 * Authoritative card zone service — the only path for card movement.
 *
 * Zones per player: deck (top=last), hand, discard, field (frontline/backline).
 * Deck legality is enforced at deck construction; generated unreachable cards may draw normally.
 */

import EVT from "../EventCatalog.js";
import CompressionService from "./CompressionService.js";
import shuffle from "../utils/shuffle.js";

export default class ZoneService {
  /**
   * Draw cards from deck to hand. Emits `game:deck:empty` on exhaustion.
   * @returns {{ drawn: number, cards: Card[] }}
   */
  static draw(playerState, amount, gameState) {
    if (!playerState.deck || !Array.isArray(playerState.deck)) {
      throw new Error("ZoneService: playerState.deck is not an array");
    }
    if (!Array.isArray(playerState.hand)) {
      playerState.hand = [];
    }

    const drawn = [];

    for (let i = 0; i < amount; i++) {
      if (playerState.deck.length === 0) {
        if (gameState?.eventBus) {
          gameState.eventBus.emit(EVT.GAME_DECK_EMPTY, {
            username: playerState.username,
          });
        }
        break;
      }

      const card = playerState.deck.pop();
      playerState.hand.push(card);
      drawn.push(card);
    }

    return { drawn: drawn.length, cards: drawn, skipped: 0 };
  }

  /**
   * Move a card to the discard pile.
   */
  static discard(playerState, card) {
    if (!Array.isArray(playerState.discard)) {
      playerState.discard = [];
    }
    CompressionService.clearReduction(card);
    playerState.discard.push(card);
  }

  /**
   * Move a card from discard to hand.
   * @returns {Card|null}
   */
  static reclaimTop(playerState) {
    if (!playerState.discard || playerState.discard.length === 0) return null;
    const card = playerState.discard.pop();
    if (!Array.isArray(playerState.hand)) playerState.hand = [];
    playerState.hand.push(card);
    return card;
  }

  /**
   * Find and remove a card from a player's hand by index.
   * @returns {Card|null}
   */
  static removeFromHand(playerState, handIndex) {
    if (!Array.isArray(playerState.hand)) return null;
    if (handIndex < 0 || handIndex >= playerState.hand.length) return null;
    const card = playerState.hand.splice(handIndex, 1)[0];
    CompressionService.clearReduction(card);
    return card;
  }

  /**
   * Add a card to a player's hand (e.g., generated cards like Incinerate).
   */
  static addToHand(playerState, card) {
    if (!Array.isArray(playerState.hand)) playerState.hand = [];
    playerState.hand.push(card);
  }

  /**
   * Shuffle the deck using a seeded RNG (deterministic).
   * Callers MUST provide a deterministic RNG; no Math.random fallback.
   */
  static shuffleDeck(playerState, rng) {
    if (!playerState.deck || !rng) return;
    shuffle(playerState.deck, rng);
  }
}
