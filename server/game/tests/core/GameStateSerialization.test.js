import GameState from "../../GameState.js";
import * as IdFactory from "../../IdFactory.js";
import { resetModifierCounter } from "../../ModifierStack.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck } from "../utils.js";

const players = ["Alice", "Bob"];

function makeGame() {
  const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
  return new GameState("SER", players, decks, "Alice", { rng: new SeededRng(99) });
}

describe("GameState.toSerializedState", () => {
  test("is deterministic across 20 identical games", () => {
    const snapshots = [];
    for (let i = 0; i < 20; i++) {
      IdFactory.resetAll();
      resetModifierCounter();
      const game = makeGame();
      snapshots.push(JSON.stringify(game.toSerializedState()));
    }
    const first = snapshots[0];
    expect(snapshots.every((s) => s === first)).toBe(true);
  });

  test("captures ordered zone contents and rng state", () => {
    IdFactory.resetAll();
    resetModifierCounter();
    const game = makeGame();
    const state = game.toSerializedState();

    expect(state.roomCode).toBe("SER");
    expect(state.usernames).toEqual(["Alice", "Bob"]);
    expect(state.players.Alice.deck).toHaveLength(GameState.INIT_DECK_SIZE - GameState.INIT_HAND_SIZE);
    expect(state.players.Alice.hand).toHaveLength(GameState.INIT_HAND_SIZE);
    expect(state.players.Alice.deck[0]).toEqual(
      expect.objectContaining({ cardId: expect.any(Number), id: expect.any(String) })
    );
    // Seeded RNG state is captured.
    expect(state.rng).toEqual({ seed: 99, calls: 0 });
    // Counters are captured.
    expect(state.counters).toEqual(
      expect.objectContaining({
        cardInstanceSeq: expect.any(Number),
        unitInstanceSeq: expect.any(Number),
        modifierSeq: expect.any(Number),
        decisionSeq: expect.any(Number),
      })
    );
  });

  test("captures modifiers, granted abilities, and decision metadata", () => {
    IdFactory.resetAll();
    resetModifierCounter();
    const game = makeGame();

    game.modifierStack.apply({
      sourceId: "Equip#1",
      sourceType: "equipment",
      targetId: "Unit#X",
      type: "trait",
      key: "barrier",
      value: 1,
    });
    game._abilityRegistry.grant("Unit#X", "Equip#1", "equipment", { type: "deal_damage", amount: 2 });
    game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "Unit#A", name: "A", hp: 3 }],
      resolve: () => {},
    });

    const state = game.toSerializedState();

    expect(state.modifiers).toEqual([
      expect.objectContaining({ id: "mod_1", targetId: "Unit#X", type: "trait", key: "barrier" }),
    ]);
    expect(state.grantedAbilities).toEqual([
      expect.objectContaining({ targetId: "Unit#X" }),
    ]);
    expect(state.pendingDecision).toEqual(
      expect.objectContaining({
        owner: "Alice",
        type: "target_selection",
        candidates: [{ id: "Unit#A", name: "A", hp: 3 }],
      })
    );
    expect(state.pendingDecisionStackDepth).toBe(0);
  });

  test("captures costReduction and visible card runtime state", () => {
    IdFactory.resetAll();
    resetModifierCounter();
    const game = makeGame();
    const card = game.playerStates.Alice.hand[0];
    card.costReduction = 2;
    card.visible = true;

    const handCard = game.toSerializedState().players.Alice.hand[0];
    expect(handCard.costReduction).toBe(2);
    expect(handCard.visible).toBe(true);
  });

  test("captures the immutable starting deck composition", () => {
    IdFactory.resetAll();
    resetModifierCounter();
    const game = makeGame();
    const state = game.toSerializedState();

    // The starting deck is captured before the initial hand draw, so it is
    // larger than the remaining draw pile and never shrinks.
    expect(state.players.Alice.startingDeck).toHaveLength(GameState.INIT_DECK_SIZE);
    expect(state.players.Bob.startingDeck).toHaveLength(GameState.INIT_DECK_SIZE);
    expect(state.players.Alice.deck).toHaveLength(GameState.INIT_DECK_SIZE - GameState.INIT_HAND_SIZE);
    expect(game.startedWithCard("Alice", state.players.Alice.startingDeck[0])).toBe(true);
  });

  test("captures pending repeat_play queues (named and wildcard)", () => {
    IdFactory.resetAll();
    resetModifierCounter();
    const game = makeGame();

    game.queueRepeatPlay("Alice", "Baang", 2);
    game.queueRepeatPlay("Alice", null, 1);

    const state = game.toSerializedState();

    expect(state.repeatPlays).toEqual({
      Alice: { "*": 1, baang: 2 },
    });
  });
});
