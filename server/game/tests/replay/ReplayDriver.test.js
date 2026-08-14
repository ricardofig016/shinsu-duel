import GameState from "../../GameState.js";
import ReplayDriver from "../../replay/ReplayDriver.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck } from "../utils.js";

const players = ["Alice", "Bob"];

function makeSeededGame(seed = 1234) {
  const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
  return new GameState("REP", players, decks, "Alice", { rng: new SeededRng(seed) });
}

describe("ReplayDriver", () => {
  test("replays a scripted game to an identical final state", () => {
    const game = makeSeededGame();

    // Advance a couple of full rounds.
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });

    const finalState = game.toSerializedState();
    const replayLog = game.logger.getReplayLog();

    const replayed = ReplayDriver.replay(replayLog);
    expect(replayed.toSerializedState()).toEqual(finalState);
  });

  test("records and replays a failed action deterministically", () => {
    const game = makeSeededGame();

    // Bob passes while it is Alice's turn → validation failure, no mutation.
    expect(() =>
      game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } })
    ).toThrow("not your turn");

    const replayLog = game.logger.getReplayLog();
    const failedAction = replayLog.actions.find((a) => a.ok === false);
    expect(failedAction).toBeDefined();
    expect(failedAction.error.message).toContain("not your turn");

    const replayed = ReplayDriver.replay(replayLog);
    expect(replayed.toSerializedState()).toEqual(game.toSerializedState());
  });

  test("resolveDecision is captured as a UserDecision entry", () => {
    const game = makeSeededGame();
    const resolved = [];
    const decisionId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "Unit#A", name: "A", hp: 3 }],
      resolve: (choices) => resolved.push(...choices),
    });
    game.resolveDecision({ decisionId, choices: ["Unit#A"] });

    const decision = game.logger.getLogs().find((l) => l.type === "UserDecision");
    expect(decision).toBeDefined();
    expect(decision.decision).toEqual({ decisionId, choices: ["Unit#A"], username: undefined });
    expect(decision.ok).toBe(true);
    expect(resolved).toEqual(["Unit#A"]);
  });

  test("throws when the log lacks a seeded RNG", () => {
    expect(() =>
      ReplayDriver.replay({ initial: { meta: { rngSeed: null } }, actions: [] })
    ).toThrow("seeded RNG");
  });

  test("throws when the log is missing its initial state", () => {
    expect(() => ReplayDriver.replay({ initial: null, actions: [] })).toThrow("initial state");
  });

  test("replay is deterministic across 20 runs of the same log", () => {
    const game = makeSeededGame(555);
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const replayLog = game.logger.getReplayLog();

    const first = JSON.stringify(ReplayDriver.replay(replayLog).toSerializedState());
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(ReplayDriver.replay(replayLog).toSerializedState())).toBe(first);
    }
  });
});
