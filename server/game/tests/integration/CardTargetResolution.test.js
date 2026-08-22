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
import { createLegalDeck, getCardIdByName, cards } from "../utils.js";

function createGame() {
  return new GameState("TEST", ["Alice", "Bob"], {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1), cards });
}

function cardInstance(game, owner, name) {
  const cardId = getCardIdByName(name);
  return new Card(cardId, game.cards[cardId], owner, game.eventBus);
}

function context(game) {
  return { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) };
}

describe("structured card target resolution via EffectResolver", () => {
  test("compress_shinsu with a type filter compresses the matching hand card", () => {
    const game = createGame();
    const equipment = cardInstance(game, "Alice", "Test Equipment Filler");
    const skill = cardInstance(game, "Alice", "Test Damage Skill");
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
    const equipmentA = cardInstance(game, "Alice", "Test Equipment Filler");
    const equipmentB = cardInstance(game, "Alice", "Test Thorn Fragment I");
    const skill = cardInstance(game, "Alice", "Test Damage Skill");
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
    const equipment = cardInstance(game, "Alice", "Test Equipment Filler");
    const skill = cardInstance(game, "Alice", "Test Damage Skill");
    game.playerStates.Alice.discard = [skill, equipment];
    game.playerStates.Alice.hand = [];

    resolveEffect(
      { type: "reclaim_cards", amount: 1, card: { type: "equipment" }, raw: "Reclaim 1 Equipment card" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(game.playerStates.Alice.hand.map((c) => c.name)).toEqual(["Test Equipment Filler"]);
    expect(game.playerStates.Alice.discard.map((c) => c.name)).toEqual(["Test Damage Skill"]);
  });

  test("draw_card with a random card target is deterministic for the same seed", () => {
    const run = () => {
      const game = createGame();
      const equipmentA = cardInstance(game, "Alice", "Test Equipment Filler");
      const equipmentB = cardInstance(game, "Alice", "Test Thorn Fragment I");
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

  test("draw_card with a type filter and no match draws nothing (legal no-op)", () => {
    const game = createGame();
    const skill = cardInstance(game, "Alice", "Test Damage Skill");
    game.playerStates.Alice.deck = [skill];
    game.playerStates.Alice.hand = [];
    const drawn = [];
    game.eventBus.on("card:drawn", () => drawn.push(true));

    const result = resolveEffect(
      { type: "draw_card", amount: 1, card: { type: "equipment" }, raw: "draw an equipment" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(result).toEqual({ skipped: true, reason: "no valid targets" });
    expect(game.playerStates.Alice.hand).toHaveLength(0);
    expect(game.playerStates.Alice.deck).toHaveLength(1);
    expect(drawn).toHaveLength(0);
  });

  test("reclaim_cards with a type filter and no match reclaims nothing (legal no-op)", () => {
    const game = createGame();
    const skill = cardInstance(game, "Alice", "Test Damage Skill");
    game.playerStates.Alice.discard = [skill];
    game.playerStates.Alice.hand = [];
    const reclaimed = [];
    game.eventBus.on("card:reclaimed", () => reclaimed.push(true));

    const result = resolveEffect(
      { type: "reclaim_cards", amount: 1, card: { type: "equipment" }, raw: "Reclaim 1 Equipment card" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(result).toEqual({ skipped: true, reason: "no valid targets" });
    expect(game.playerStates.Alice.hand).toHaveLength(0);
    expect(game.playerStates.Alice.discard).toHaveLength(1);
    expect(reclaimed).toHaveLength(0);
  });

  test("compress_shinsu honors an explicit card zone (hand)", () => {
    const game = createGame();
    const equipment = cardInstance(game, "Alice", "Test Equipment Filler");
    game.playerStates.Alice.hand = [equipment];

    resolveEffect(
      { type: "compress_shinsu", amount: 2, card: { zone: "hand", type: "equipment" }, raw: "Compress 2 from an equipment" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(equipment.costReduction).toBe(2);
  });

  test("draw_card honors an explicit card zone (deck)", () => {
    const game = createGame();
    const equipment = cardInstance(game, "Alice", "Test Equipment Filler");
    game.playerStates.Alice.deck = [equipment];
    game.playerStates.Alice.hand = [];

    resolveEffect(
      { type: "draw_card", amount: 1, card: { zone: "deck", type: "equipment" }, raw: "draw an equipment" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(game.playerStates.Alice.hand.map((c) => c.name)).toEqual(["Test Equipment Filler"]);
    expect(game.playerStates.Alice.deck).toHaveLength(0);
  });

  test("reclaim_cards honors an explicit card zone (discard)", () => {
    const game = createGame();
    const equipment = cardInstance(game, "Alice", "Test Equipment Filler");
    game.playerStates.Alice.discard = [equipment];
    game.playerStates.Alice.hand = [];

    resolveEffect(
      { type: "reclaim_cards", amount: 1, card: { zone: "discard", type: "equipment" }, raw: "Reclaim 1 Equipment card" },
      context(game), game,
      { owner: "Alice" }
    );

    expect(game.playerStates.Alice.hand.map((c) => c.name)).toEqual(["Test Equipment Filler"]);
    expect(game.playerStates.Alice.discard).toHaveLength(0);
  });
});
