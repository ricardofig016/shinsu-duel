import { createSeededGame } from "../gameFactory.js";
import GameState from "../GameState.js";
import * as IdFactory from "../IdFactory.js";
import { resetModifierCounter } from "../ModifierStack.js";
import { createLegalDeck } from "./utils.js";

const players = ["Alice", "Bob"];

// The initial hand is drawn from the top (end) of the deck, so reconstruct the
// original 30-card deck order as deck + reversed hand.
function fullDeck(playerState) {
  return [...playerState.deck, ...[...playerState.hand].reverse()].map((c) => c.cardId);
}

describe("createSeededGame", () => {
  test("throws when seed is not a number", () => {
    expect(() => createSeededGame({ roomCode: "R", usernames: players })).toThrow(/numeric seed/);
    expect(() => createSeededGame({ roomCode: "R", usernames: players, seed: "abc" })).toThrow(/numeric seed/);
  });

  test("builds a game whose RNG carries the given seed", () => {
    const game = createSeededGame({ roomCode: "R", usernames: players, seed: 42 });
    expect(game._rng.getState().seed).toBe(42);
  });

  test("is deterministic for a fixed seed", () => {
    const snapshots = [];
    for (let i = 0; i < 5; i++) {
      IdFactory.resetAll();
      resetModifierCounter();
      const game = createSeededGame({ roomCode: "R", usernames: players, seed: 42 });
      snapshots.push(JSON.stringify(game.toSerializedState()));
    }
    expect(snapshots.every((s) => s === snapshots[0])).toBe(true);
  });

  test("honors an explicit firstPlayer", () => {
    const game = createSeededGame({ roomCode: "R", usernames: players, seed: 42, firstPlayer: "Bob" });
    expect(game.currentTurn).toBe("Bob");
  });

  test("rolls a valid first player when none is given", () => {
    const game = createSeededGame({ roomCode: "R", usernames: players, seed: 42 });
    expect(players).toContain(game.currentTurn);
  });

  test("honors explicit decks without reordering", () => {
    const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
    const game = createSeededGame({ roomCode: "R", usernames: players, seed: 42, decks });
    for (const username of players) {
      expect(fullDeck(game.playerStates[username])).toEqual(decks[username]);
    }
  });

  test("generates a legal 30-card default deck for each player", () => {
    const game = createSeededGame({ roomCode: "R", usernames: players, seed: 42 });
    const eligible = new Set(GameState.getEligibleCardIds());
    for (const username of players) {
      const deck = fullDeck(game.playerStates[username]);
      expect(deck).toHaveLength(30);
      expect(new Set(deck).size).toBe(30);
      expect(deck.every((id) => eligible.has(id))).toBe(true);
    }
  });
});
