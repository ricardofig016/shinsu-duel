import { jest } from "@jest/globals";
import GameState from "../GameState.js";
import SeededRng from "../utils/SeededRng.js";
import AnimaEngine from "../attributes/AnimaEngine.js";
import { createLegalDeck, getCardIdByName } from "./utils.js";

describe("AnimaEngine", () => {
  let game;

  beforeEach(() => {
    game = new GameState("ANIMA", ["Alice", "Bob"], {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    }, null, { rng: new SeededRng(1) });
  });

  test("initial state has no shinheuh slot available", () => {
    const slot = game.playerStates.Alice.shinheuhSlot;
    expect(slot.available).toBe(false);
    expect(slot.used).toBe(false);
  });

  test("consumeSlot returns false when slot unavailable", () => {
    expect(AnimaEngine.consumeSlot("Alice", game)).toBe(false);
  });

  test("round end resets the slot", () => {
    game.playerStates.Alice.shinheuhSlot = { available: true, used: true };
    AnimaEngine.resetSlot("Alice", game);

    expect(game.playerStates.Alice.shinheuhSlot.available).toBe(false);
    expect(game.playerStates.Alice.shinheuhSlot.used).toBe(false);
  });

  test("consumeSlot consumes available slot via GameState mutation method", () => {
    game.playerStates.Alice.shinheuhSlot = { available: true, used: false };
    expect(AnimaEngine.consumeSlot("Alice", game)).toBe(true);
    expect(game.playerStates.Alice.shinheuhSlot.available).toBe(false);
    expect(game.playerStates.Alice.shinheuhSlot.used).toBe(true);
  });

  test("onDeploy registers round-start listener", () => {
    const unit = { id: "Unit#test", owner: "Alice", card: { attributes: ["anima"] }, _animaCleanup: [] };
    const engine = game._attributeRegistry.get("anima");
    engine.onDeploy(unit, game);

    expect(unit._animaCleanup.length).toBe(1);
  });

  test("cleanup removes subscriptions", () => {
    const unsub = jest.fn();
    const unit = { _animaCleanup: [unsub] };
    const engine = game._attributeRegistry.get("anima");
    engine.cleanup(unit);

    expect(unsub).toHaveBeenCalled();
    expect(unit._animaCleanup.length).toBe(0);
  });
});
