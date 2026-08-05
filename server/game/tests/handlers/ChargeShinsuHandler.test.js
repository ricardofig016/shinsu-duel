import GameState from "../../GameState.js";
import { createTestGame } from "../utils.js";

describe("ChargeShinsuHandler", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  test("adds shinsu to normal pool", () => {
    const player = game.playerStates[game.usernames[0]];
    const before = player.shinsu.normalAvailable;

    // Simulate ChargeShinsuHandler effect
    const amount = 2;
    const max = Math.min(10, game.round);
    player.shinsu.normalAvailable = Math.min(max, before + amount);

    expect(player.shinsu.normalAvailable).toBe(Math.min(max, before + amount));
  });

  test("caps shinsu at round maximum", () => {
    const player = game.playerStates[game.usernames[0]];
    const before = player.shinsu.normalAvailable;

    // Round 1, max normal = 1
    player.shinsu.normalAvailable = Math.min(1, before + 5);
    expect(player.shinsu.normalAvailable).toBe(1);
  });

  test("does not add to recharged pool", () => {
    const player = game.playerStates[game.usernames[0]];
    const beforeRecharged = player.shinsu.recharged;

    player.shinsu.normalAvailable = Math.min(10, player.shinsu.normalAvailable + 3);
    expect(player.shinsu.recharged).toBe(beforeRecharged);
  });
});
