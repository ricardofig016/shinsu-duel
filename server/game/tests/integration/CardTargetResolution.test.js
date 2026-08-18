/**
 * Integration: structured `card` targets through EffectResolver.
 *
 * Verifies that EffectResolver resolves a structured `card` target (name/type/
 * cost/attribute/choose/random) against the right zone (hand/deck/discard) and
 * hands the handler a concrete `targetCardId` — or defers to a `card_selection`
 * decision for `choose`, or picks deterministically for `random`.
 */

import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import { resolveEffect } from "../../EffectResolver.js";
import { createLegalDeck, getCardIdByName } from "../utils.js";

function createGame() {
  return new GameState("TEST", ["Alice", "Bob"], {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1) });
}

function cardInstance(game, owner, name) {
  const cardId = getCardIdByName(name);
  return new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);
}

function context(game) {
  return { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) };
}

describe("structured card target resolution via EffectResolver", () => {
  test("compress_shinsu with a type filter compresses the matching hand card", () => {
    const game = createGame();
    const equipment = cardInstance(game, "Alice", "Frog Fisher");
    const skill = cardInstance(game, "Alice", "Baang");
    game.playerStates.Alice.hand = [skill, equipment];

    resolveEffect(
      { type: "compress_shinsu", amount: 2, card: { type: "equipment" }, raw: "Compress 2 from an equipment" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(equipment.costReduction).toBe(2);
    expect(skill.costReduction).toBe(0);
  });

  test("draw_card with a type filter + choose defers to a card_selection decision", () => {
    const game = createGame();
    const equipmentA = cardInstance(game, "Alice", "Frog Fisher");
    const equipmentB = cardInstance(game, "Alice", "First Thorn Fragment");
    const skill = cardInstance(game, "Alice", "Baang");
    game.playerStates.Alice.deck = [skill, equipmentA, equipmentB];
    game.playerStates.Alice.hand = [];

    const result = resolveEffect(
      { type: "draw_card", amount: 1, card: { type: "equipment", choose: true }, raw: "draw an equipment of your choice" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.type).toBe("card_selection");
    expect(game.pendingDecision.candidates).toHaveLength(2);

    const chosen = game.pendingDecision.candidates[0];
    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [chosen.id],
      username: "Alice",
    });

    expect(game.playerStates.Alice.hand.some((c) => c.id === chosen.id)).toBe(true);
  });

  test("reclaim_cards with a type filter reclaims the matching discard card", () => {
    const game = createGame();
    const equipment = cardInstance(game, "Alice", "Frog Fisher");
    const skill = cardInstance(game, "Alice", "Baang");
    game.playerStates.Alice.discard = [skill, equipment];
    game.playerStates.Alice.hand = [];

    resolveEffect(
      { type: "reclaim_cards", amount: 1, card: { type: "equipment" }, raw: "Reclaim 1 Equipment card" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(game.playerStates.Alice.hand.map((c) => c.name)).toEqual(["Frog Fisher"]);
    expect(game.playerStates.Alice.discard.map((c) => c.name)).toEqual(["Baang"]);
  });

  test("draw_card with a random card target is deterministic for the same seed", () => {
    const run = () => {
      const game = createGame();
      const equipmentA = cardInstance(game, "Alice", "Frog Fisher");
      const equipmentB = cardInstance(game, "Alice", "First Thorn Fragment");
      game.playerStates.Alice.deck = [equipmentA, equipmentB];
      game.playerStates.Alice.hand = [];

      resolveEffect(
        { type: "draw_card", amount: 1, card: { type: "equipment", random: true }, raw: "draw a random equipment" },
        context(game), game,
        { owner: "Alice" }
      );

      return game.playerStates.Alice.hand.map((c) => c.name);
    };

    const first = run();
    const second = run();

    expect(first).toHaveLength(1);
    expect(first).toEqual(second);
  });
});
