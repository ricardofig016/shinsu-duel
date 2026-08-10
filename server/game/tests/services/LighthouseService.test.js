import { createTestGame } from "../utils.js";
import LighthouseService from "../../services/LighthouseService.js";

describe("LighthouseService", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  test("modify adds lighthouses and caps at 40", () => {
    const result = LighthouseService.modify(game, "Alice", 10);
    expect(result.newAmount).toBe(30);

    const capped = LighthouseService.modify(game, "Alice", 20);
    expect(capped.newAmount).toBe(40);
    expect(capped.delta).toBe(10); // only added 10
  });

  test("modify removes lighthouses and floors at 0", () => {
    LighthouseService.modify(game, "Alice", 10);
    const result = LighthouseService.modify(game, "Alice", -40);
    expect(result.newAmount).toBe(0);
  });

  test("reaching 0 triggers game over", () => {
    game.gameOver = null;
    LighthouseService.modify(game, "Alice", -20);

    expect(game.gameOver).not.toBeNull();
    expect(game.gameOver.winner).toBe("Bob");
    expect(game.gameOver.reason).toBe("lighthouses depleted");
  });

  test("does not double-trigger game over", () => {
    game.gameOver = { winner: "Bob", reason: "lighthouses depleted" };
    const result = LighthouseService.modify(game, "Alice", -1);

    expect(result.newAmount).toBe(19); // still does the modification
  });

  test("throws for unknown player", () => {
    expect(() => LighthouseService.modify(game, "Unknown", 5)).toThrow("not found");
  });
});
