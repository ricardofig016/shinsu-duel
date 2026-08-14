/**
 * Integration test: compress_shinsu targeting through EffectResolver.
 *
 * Verifies that EffectResolver pre-resolves targetCardSelector into
 * concrete targetCardId before the handler is invoked.
 */

import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import { resolveEffect, initEffectResolver } from "../../EffectResolver.js";
import { createLegalDeck, getCardIdByName } from "../utils.js";

describe("compress_shinsu targeting integration via EffectResolver", () => {
  let game;

  beforeEach(() => {
    initEffectResolver();
    game = new GameState("TEST", ["Alice", "Bob"], {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    }, null, { rng: new SeededRng(1) });
    // Clear hand for controlled setup
    game.playerStates.Alice.hand = [];
  });

  function addCardToHand(owner, cardName) {
    const cardId = getCardIdByName(cardName);
    const card = new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);
    game.playerStates[owner].hand.push(card);
    return card;
  }

  test("EffectResolver resolves name selector to targetCardId before handler", () => {
    const target = addCardToHand("Alice", "Fiery Elephant");
    const context = {
      emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload),
    };

    const result = resolveEffect(
      {
        type: "compress_shinsu",
        amount: 1,
        targetCardSelector: "Fiery Elephant",
        raw: "Compress 1 from Fiery Elephant in your hand",
      },
      context,
      game,
      { owner: "Alice" }
    );

    expect(result?.totalReduction).toBe(1);
    expect(target.costReduction).toBe(1);
  });

  test("EffectResolver resolves attribute selector to targetCardId", () => {
    const hwayeomsa = addCardToHand("Alice", "Yeon Yihwa");
    const other = addCardToHand("Alice", "Monkeyman");
    const context = {
      emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload),
    };

    resolveEffect(
      {
        type: "compress_shinsu",
        amount: 2,
        targetCardSelector: "a Hwayeomsa",
        raw: "Compress 2 from a Hwayeomsa in your hand",
      },
      context,
      game,
      { owner: "Alice" }
    );

    expect(hwayeomsa.costReduction).toBe(2);
    expect(other.costReduction).toBe(0);
  });

  test("EffectResolver resolves most-expensive selector", () => {
    const cheap = addCardToHand("Alice", "Monkeyman");
    const expensive = addCardToHand("Alice", "The Workshop");
    const context = {
      emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload),
    };

    resolveEffect(
      {
        type: "compress_shinsu",
        amount: 3,
        targetCardSelector: "the most expensive card",
        raw: "Compress 3 from the most expensive card in your hand",
      },
      context,
      game,
      { owner: "Alice" }
    );

    expect(cheap.costReduction).toBe(0);
    expect(expensive.costReduction).toBe(3);
  });

  test("handler throws when no card matches the selector", () => {
    const context = {
      emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload),
    };

    expect(() =>
      resolveEffect(
        {
          type: "compress_shinsu",
          amount: 1,
          targetCardSelector: "Nonexistent Card",
          raw: "Compress 1 from Nonexistent Card in your hand",
        },
        context,
        game,
        { owner: "Alice" }
      )
    ).toThrow(/targetCardId/);
  });
});
