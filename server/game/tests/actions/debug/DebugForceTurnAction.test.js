import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction } from "../../utils.js";

const forceTurn = (game) => game.processAction(debugAction("debug-force-turn-action", {}));

describe("DebugForceTurnAction", () => {
  test("hands the turn to the other player through the turn lifecycle", () => {
    const game = createTestGame();
    const phases = [];
    game.eventBus.on(EVT.TURN_END, (payload) => phases.push(`end:${payload.username}`), { phase: "post" });
    game.eventBus.on(EVT.TURN_START, (payload) => phases.push(`start:${payload.username}`), { phase: "post" });

    forceTurn(game);

    expect(game.currentTurn).toBe("Bob");
    expect(phases).toEqual(["end:Alice", "start:Bob"]);
  });

  test("never ends the round, even after a pass set the flag", () => {
    const game = createTestGame();
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    expect(game.roundEndOnTurnEnd).toBe(true);

    forceTurn(game);

    expect(game.round).toBe(1);
    expect(game.roundEndOnTurnEnd).toBe(false);
  });

  test("rejects a player source and a finished game", () => {
    const game = createTestGame();
    expect(() =>
      game.processAction({
        type: "debug-force-turn-action",
        data: { source: "player", requestedBy: "Bob" },
      })
    ).toThrow("Source player is not allowed to perform this action.");

    const finished = createTestGame();
    finished.gameOver = { winner: "Bob", reason: "lighthouses depleted" };
    expect(() => forceTurn(finished)).toThrow("The game is over.");
  });
});
