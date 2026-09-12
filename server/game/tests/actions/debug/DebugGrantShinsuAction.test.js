import EVT from "../../../EventCatalog.js";
import { createTestGame, debugAction } from "../../utils.js";

const grantShinsu = (game, data) => game.processAction(debugAction("debug-grant-shinsu-action", data));

describe("DebugGrantShinsuAction", () => {
  test("gains shinsu and charges the normal pool only", () => {
    const game = createTestGame();
    const charged = [];
    game.eventBus.on(EVT.SHINSU_CHARGED, (payload) => charged.push(payload), { phase: "post" });
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 1 };

    grantShinsu(game, { username: "Alice", amount: 2 });

    expect(game.playerStates.Alice.shinsu).toEqual({ normalSpent: 0, normalAvailable: 4, recharged: 1 });
    expect(charged).toEqual([{ owner: "Alice", amount: 2, total: 5 }]);
  });

  test("respects the rules cap for the current round", () => {
    const game = createTestGame();
    game.round = 3;
    game.playerStates.Bob.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 0 };

    grantShinsu(game, { username: "Bob", amount: 10 });

    expect(game.playerStates.Bob.shinsu.normalAvailable).toBe(3);
  });

  test("rejects a non-positive amount, an unknown seat, and a player source", () => {
    const game = createTestGame();
    expect(() => grantShinsu(game, { username: "Alice", amount: 0 })).toThrow(
      "amount must be an integer between 1"
    );
    expect(() => grantShinsu(game, { username: "Mallory", amount: 1 })).toThrow("Player Mallory not found.");
    expect(() =>
      game.processAction({
        type: "debug-grant-shinsu-action",
        data: { source: "player", requestedBy: "Bob", username: "Alice", amount: 1 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
