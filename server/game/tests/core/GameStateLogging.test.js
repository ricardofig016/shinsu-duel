import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck, cards } from "../utils.js";

const PLAYERS = ["Alice", "Bob"];

function recordingBackend() {
  const entries = [];
  return {
    entries,
    backend: { write: (entry) => entries.push(entry), getAll: () => entries, clear: () => {} },
  };
}

function buildGame(loggerBackends) {
  const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
  return new GameState("LOGTEST", PLAYERS, decks, "Alice", { rng: new SeededRng(1), cards, loggerBackends });
}

describe("GameState logger backends", () => {
  test("constructor-injected backends receive the InitialState entry", () => {
    const { entries, backend } = recordingBackend();
    const game = buildGame([backend]);

    const initial = entries.find((entry) => entry.type === "InitialState");
    expect(initial).toBeDefined();
    expect(initial.meta.roomCode).toBe("LOGTEST");
    expect(initial.meta.rngSeed).toBe(1);
    expect(initial.state).toEqual(game.toSerializedState());
  });

  test("constructor-injected backends receive UserAction entries", () => {
    const { entries, backend } = recordingBackend();
    const game = buildGame([backend]);

    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });

    const action = entries.find((entry) => entry.type === "UserAction");
    expect(action).toBeDefined();
    expect(action.action.type).toBe("pass-turn-action");
    expect(action.ok).toBe(true);
    // The entry carries the diff against the initial state, not a full copy.
    expect(action.diff.changed.currentTurn).toBe("Bob");
  });

  test("failed player actions reach backends recorded with their error", () => {
    const { entries, backend } = recordingBackend();
    const game = buildGame([backend]);

    expect(() =>
      game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } })
    ).toThrow("not your turn");

    const failed = entries.find((entry) => entry.type === "UserAction");
    expect(failed).toBeDefined();
    expect(failed.ok).toBe(false);
    expect(failed.error).toBeDefined();
    // A failed input must change nothing: an empty diff.
    expect(failed.diff).toEqual({ changed: {}, removed: [] });
  });

  test("a game without loggerBackends still logs to memory only", () => {
    const game = buildGame([]);

    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });

    expect(game.logger.getLogs().some((entry) => entry.type === "UserAction")).toBe(true);
  });
});
