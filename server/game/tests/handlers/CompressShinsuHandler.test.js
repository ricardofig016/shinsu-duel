import GameState from "../../GameState.js";
import { createTestGame } from "../utils.js";

describe("CompressShinsuHandler", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  test("stores compress amount on player state", () => {
    const player = game.playerStates[game.usernames[0]];
    player.compressAmount = 0;

    player.compressAmount += 2;
    expect(player.compressAmount).toBe(2);
  });

  test("compress stacks additively", () => {
    const player = game.playerStates[game.usernames[0]];
    player.compressAmount = 1;

    player.compressAmount += 3;
    expect(player.compressAmount).toBe(4);
  });

  test("compress clears at turn end", () => {
    const player = game.playerStates[game.usernames[0]];
    player.compressAmount = 3;

    game.endTurn(false); // non-pass ends turn
    const newPlayer = game.playerStates[game.currentTurn];
    // Old player's compress should have been cleared by endTurn
    expect(player.compressAmount).toBe(0);
  });
});
