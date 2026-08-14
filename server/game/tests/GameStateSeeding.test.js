import GameState from "../GameState.js";
import SeededRng from "../utils/SeededRng.js";
import { createLegalDeck } from "./utils.js";

const players = ["Alice", "Bob"];

// The initial hand is drawn from the top (end) of the deck, so reconstruct the
// original 30-card deck order as deck + reversed hand.
function fullDeck(playerState) {
  return [...playerState.deck, ...[...playerState.hand].reverse()].map((c) => c.cardId);
}

describe("GameState seeded RNG enforcement", () => {
  test("throws when options.rng is missing", () => {
    expect(
      () => new GameState("S", players, { Alice: createLegalDeck(), Bob: createLegalDeck() })
    ).toThrow(/seeded RNG/);
  });

  test("throws when options.rng is a plain function (no next/getState)", () => {
    expect(
      () =>
        new GameState(
          "S",
          players,
          { Alice: createLegalDeck(), Bob: createLegalDeck() },
          null,
          { rng: () => Math.random() }
        )
    ).toThrow(/seeded RNG/);
  });

  test("accepts a SeededRng", () => {
    const game = new GameState(
      "S",
      players,
      { Alice: createLegalDeck(), Bob: createLegalDeck() },
      null,
      { rng: new SeededRng(1) }
    );
    expect(game._rng.getState().seed).toBe(1);
  });

  test("honors an explicit firstPlayer", () => {
    const game = new GameState(
      "S",
      players,
      { Alice: createLegalDeck(), Bob: createLegalDeck() },
      "Bob",
      { rng: new SeededRng(1) }
    );
    expect(game.currentTurn).toBe("Bob");
  });

  test("defaults first player deterministically to the first username", () => {
    const game = new GameState(
      "S",
      players,
      { Alice: createLegalDeck(), Bob: createLegalDeck() },
      null,
      { rng: new SeededRng(1) }
    );
    expect(game.currentTurn).toBe(players[0]);
  });

  test("generates a deterministic default deck of 30 unique eligible cards", () => {
    const a = new GameState("S", players, {}, null, { rng: new SeededRng(1) });
    const b = new GameState("S", players, {}, null, { rng: new SeededRng(1) });
    const eligible = new Set(GameState.getEligibleCardIds());

    for (const game of [a, b]) {
      const deck = fullDeck(game.playerStates.Alice);
      expect(deck).toHaveLength(30);
      expect(new Set(deck).size).toBe(30);
      expect(deck.every((id) => eligible.has(id))).toBe(true);
    }

    expect(fullDeck(a.playerStates.Alice)).toEqual(fullDeck(b.playerStates.Alice));
  });
});
