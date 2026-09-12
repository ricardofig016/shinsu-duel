import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction } from "../../utils.js";

const endRound = (game) => game.processAction(debugAction("debug-end-round-action", {}));

describe("DebugEndRoundAction", () => {
  test("runs the round-end phase, resets shinsu, and draws for both seats", () => {
    const game = createTestGame();
    const phases = [];
    game.eventBus.on(EVT.ROUND_END, () => phases.push("end"), { phase: "post" });
    game.eventBus.on(EVT.ROUND_START, () => phases.push("start"), { phase: "post" });
    const hands = {
      Alice: game.playerStates.Alice.hand.length,
      Bob: game.playerStates.Bob.hand.length,
    };

    endRound(game);

    expect(game.round).toBe(2);
    expect(phases).toEqual(["end", "start"]);
    expect(game.playerStates.Alice.hand).toHaveLength(hands.Alice + 1);
    expect(game.playerStates.Bob.hand).toHaveLength(hands.Bob + 1);
    expect(game.playerStates.Alice.shinsu.normalAvailable).toBe(2);
    expect(game.currentTurn).toBe("Alice");
  });

  test("clears the pass flag so the next pass does not end the round again", () => {
    const game = createTestGame();
    game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: "Alice" },
    });
    expect(game.roundEndOnTurnEnd).toBe(true);

    endRound(game);

    expect(game.roundEndOnTurnEnd).toBe(false);
    expect(game.round).toBe(2);
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    expect(game.roundEndOnTurnEnd).toBe(true);
    expect(game.round).toBe(2);
  });

  test("rejects a pending decision, a finished game, and a player source", () => {
    const pending = createTestGame();
    pending.createPendingDecision({
      owner: "Alice",
      type: "line_overflow",
      candidates: [{ id: "unit-1", name: "Test Scout", hp: 2 }],
      resolve: () => {},
    });
    expect(() => endRound(pending)).toThrow("A player decision must be resolved before another action.");

    const finished = createTestGame();
    finished.gameOver = { winner: "Bob", reason: "deck exhausted" };
    expect(() => endRound(finished)).toThrow("The game is over.");

    const game = createTestGame();
    expect(() =>
      game.processAction({
        type: "debug-end-round-action",
        data: { source: "player", requestedBy: "Bob" },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
