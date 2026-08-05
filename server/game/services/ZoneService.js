/**
 * Authoritative card zone service — the only path for card movement.
 *
 * Zones per player: deck (top=last), hand, discard, field (frontline/backline).
 * Enforces deck constraints (unreachable), empty-deck loss, and draw rules.
 */

export default class ZoneService {
  /**
   * Draw cards from deck to hand.
   * Skips unreachable cards. Emits `game:deck:empty` on exhaustion.
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
    const skipped = [];

    for (let i = 0; i < amount; i++) {
      if (playerState.deck.length === 0) {
        // Empty deck — emit loss event
        if (gameState?.eventBus) {
          gameState.eventBus.emit("game:deck:empty", {
            username: playerState.username,
          });
        }
        break;
      }

      const card = playerState.deck.pop();

      // Skip unreachable cards
      if (card.isUnreachable?.() || card._isUnreachable) {
        skipped.push(card);
        i--; // redraw to replace skipped card
        continue;
      }

      playerState.hand.push(card);
      drawn.push(card);
    }

    return { drawn: drawn.length, cards: drawn, skipped: skipped.length };
  }

  /**
   * Move a card to the discard pile.
   */
  static discard(playerState, card) {
    if (!Array.isArray(playerState.discard)) {
      playerState.discard = [];
    }
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
    return playerState.hand.splice(handIndex, 1)[0];
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
   */
  static shuffleDeck(playerState, rng = Math.random) {
    if (!playerState.deck) return;
    const arr = playerState.deck;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}
