import { createTestGame, debugAction } from "../../utils.js";

const setRound = (game, round) => game.processAction(debugAction("debug-set-round-action", { round }));

describe("DebugSetRoundAction", () => {
  test("sets the round counter and leaves the board untouched", () => {
    const game = createTestGame();
    const handBefore = game.playerStates.Alice.hand.map((card) => card.id);
    const shinsuBefore = { ...game.playerStates.Alice.shinsu };

    setRound(game, 7);

    expect(game.round).toBe(7);
    expect(game.playerStates.Alice.hand.map((card) => card.id)).toEqual(handBefore);
    expect(game.playerStates.Alice.shinsu).toEqual(shinsuBefore);
  });

  test("the next round end advances from the value set", () => {
    const game = createTestGame();

    setRound(game, 4);
    game.processAction(debugAction("debug-end-round-action", {}));

    expect(game.round).toBe(5);
    expect(game.playerStates.Alice.shinsu.normalAvailable).toBe(5);
  });

  test("rejects invalid rounds and a player source", () => {
    const game = createTestGame();
    expect(() => setRound(game, 0)).toThrow("round must be an integer between 1");
    expect(() => setRound(game, 2.5)).toThrow("round must be an integer between 1");
    expect(() =>
      game.processAction({
        type: "debug-set-round-action",
        data: { source: "player", requestedBy: "Bob", round: 2 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
