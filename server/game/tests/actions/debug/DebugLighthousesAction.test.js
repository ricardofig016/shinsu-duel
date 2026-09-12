import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction } from "../../utils.js";

const modifyLighthouses = (game, data) =>
  game.processAction(debugAction("debug-lighthouses-action", data));

describe("DebugLighthousesAction", () => {
  test("changes a seat's lighthouse count", () => {
    const game = createTestGame();
    game.playerStates.Alice.lighthouses = { amount: 20, max: 40 };

    modifyLighthouses(game, { username: "Alice", amount: -5 });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(15);

    modifyLighthouses(game, { username: "Alice", amount: 3 });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(18);
  });

  test("keeps the service's 0-40 clamp", () => {
    const game = createTestGame();

    modifyLighthouses(game, { username: "Bob", amount: 1000 });
    expect(game.playerStates.Bob.lighthouses.amount).toBe(40);

    modifyLighthouses(game, { username: "Bob", amount: -5 });
    expect(game.playerStates.Bob.lighthouses.amount).toBe(35);
  });

  test("reaching zero still ends the game", () => {
    const game = createTestGame();
    const over = [];
    game.eventBus.on(EVT.GAME_OVER, (payload) => over.push(payload), { phase: "post" });
    game.playerStates.Bob.lighthouses = { amount: 3, max: 40 };

    modifyLighthouses(game, { username: "Bob", amount: -3 });

    expect(game.playerStates.Bob.lighthouses.amount).toBe(0);
    expect(over).toEqual([{ winner: "Alice", reason: "lighthouses depleted" }]);
    expect(game.gameOver).toEqual({ winner: "Alice", reason: "lighthouses depleted" });
  });

  test("rejects an unknown seat and a player source", () => {
    const game = createTestGame();
    expect(() => modifyLighthouses(game, { username: "Mallory", amount: 1 })).toThrow(
      "Player Mallory not found."
    );
    expect(() =>
      game.processAction({
        type: "debug-lighthouses-action",
        data: { source: "player", requestedBy: "Bob", username: "Alice", amount: 1 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });

  test("the game-over guard stops further debug mutations", () => {
    const game = createTestGame();
    game.playerStates.Bob.lighthouses = { amount: 1, max: 40 };
    modifyLighthouses(game, { username: "Bob", amount: -1 });
    expect(game.gameOver).not.toBeNull();

    expect(() => modifyLighthouses(game, { username: "Alice", amount: 1 })).toThrow("The game is over.");
  });
});
