import GameState from "../../GameState.js";
import ReplayDriver from "../../replay/ReplayDriver.js";
import SeededRng from "../../utils/SeededRng.js";
import { createSeededGame } from "../../gameFactory.js";
import { createLegalDeck, cards } from "../utils.js";

const players = ["Alice", "Bob"];

function makeSeededGame(seed = 1234) {
  const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
  return new GameState("REP", players, decks, "Alice", { rng: new SeededRng(seed), cards });
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

    const replayed = ReplayDriver.replay(replayLog, { cards });
    expect(replayed.toSerializedState()).toEqual(finalState);
  });

  test("replays a game created by the seeded factory with factory-built decks", () => {
    // The factory builds default decks before GameState exists, consuming
    // RNG draws up front; the replay must restore that exact RNG position.
    // The fixture catalog is injected (tests must never depend on shipped
    // card data); buildDefaultDeck still consumes draws with it.
    const game = createSeededGame({ roomCode: "REP", usernames: players, seed: 42, cards });

    game.processAction({ type: "pass-turn-action", data: { source: "player", username: game.currentTurn } });
    const replayLog = game.logger.getReplayLog();

    const replayed = ReplayDriver.replay(replayLog, { cards });
    expect(replayed.toSerializedState()).toEqual(game.toSerializedState());
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

    const replayed = ReplayDriver.replay(replayLog, { cards });
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

  test("throws on an unknown replay entry type", () => {
    const game = makeSeededGame();
    const replayLog = game.logger.getReplayLog();
    replayLog.actions.push({ type: "BogusEntry", ok: true, diff: { changed: {}, removed: [] } });

    expect(() => ReplayDriver.replay(replayLog, { cards })).toThrow("Unknown replay entry type");
  });

  test("throws when an entry expected to fail succeeds", () => {
    const game = makeSeededGame();
    const replayLog = game.logger.getReplayLog();
    // A valid pass action that should succeed, but is recorded as a failure.
    replayLog.actions.push({
      type: "UserAction",
      ok: false,
      action: { type: "pass-turn-action", data: { source: "player", username: "Alice" } },
      diff: { changed: {}, removed: [] },
    });

    expect(() => ReplayDriver.replay(replayLog, { cards })).toThrow("Expected replay step");
  });

  test("rejects legacy full-state artifacts loudly", () => {
    const game = makeSeededGame();
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    const replayLog = game.logger.getReplayLog();
    replayLog.actions[0].stateAfter = game.toSerializedState();

    expect(() => ReplayDriver.replay(replayLog, { cards })).toThrow(/no longer supported/);
  });

  test("rejects entries without a well-formed diff", () => {
    const game = makeSeededGame();
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    const replayLog = game.logger.getReplayLog();
    delete replayLog.actions[0].diff;

    expect(() => ReplayDriver.replay(replayLog, { cards })).toThrow(/well-formed/);
  });

  test("throws when the replay diverges from the recorded state", () => {
    const game = makeSeededGame();
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    const replayLog = game.logger.getReplayLog();
    // Tamper with the recorded post-action diff to force a divergence.
    replayLog.actions[0].diff = { changed: { round: 99 }, removed: [] };

    expect(() => ReplayDriver.replay(replayLog, { cards })).toThrow("Replay divergence");
  });

  test("replay is deterministic across 20 runs of the same log", () => {
    const game = makeSeededGame(555);
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const replayLog = game.logger.getReplayLog();

    const first = JSON.stringify(ReplayDriver.replay(replayLog, { cards }).toSerializedState());
    for (let i = 0; i < 20; i++) {
      expect(JSON.stringify(ReplayDriver.replay(replayLog, { cards }).toSerializedState())).toBe(first);
    }
  });
});
