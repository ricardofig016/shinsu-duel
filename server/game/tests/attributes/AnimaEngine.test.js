import { jest } from "@jest/globals";
import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import AnimaEngine from "../../attributes/AnimaEngine.js";
import EVT from "../../EventCatalog.js";
import { createLegalDeck, getCardIdByName, cards } from "../utils.js";

describe("AnimaEngine", () => {
  let game;

  beforeEach(() => {
    game = new GameState("ANIMA", ["Alice", "Bob"], {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    }, null, { rng: new SeededRng(1), cards });
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

  test("round start grants a Shinheuh slot when an Anima unit is on the field", () => {
    game.playerStates.Alice.shinheuhSlot = { available: false, used: false };
    const engine = game._attributeRegistry.get("anima");
    const unit = { id: "Unit#anima", owner: "Alice", card: { attributes: ["anima"] } };
    game.playerStates.Alice.field.frontline = [unit];
    engine.onDeploy(unit, game);

    game.eventBus.emit(EVT.ROUND_START, { round: 2 });

    expect(game.playerStates.Alice.shinheuhSlot.available).toBe(true);
  });

  test("round start revokes the slot when no Anima unit is on the field", () => {
    game.playerStates.Alice.shinheuhSlot = { available: true, used: false };
    const engine = game._attributeRegistry.get("anima");
    const unit = { id: "Unit#noanima", owner: "Alice", card: { attributes: [] } };
    game.playerStates.Alice.field.frontline = [unit];
    engine.onDeploy(unit, game);

    game.eventBus.emit(EVT.ROUND_START, { round: 2 });

    expect(game.playerStates.Alice.shinheuhSlot.available).toBe(false);
  });

  test("_hasAnimaOnField recognizes an anima attribute granted via modifier", () => {
    const engine = game._attributeRegistry.get("anima");
    const unit = { id: "Unit#mod", owner: "Alice", card: { attributes: [] } };
    game.playerStates.Alice.field.frontline = [unit];
    game.modifierStack.apply({
      sourceId: "System", sourceType: "system", targetId: unit.id,
      type: "attribute", key: "anima", value: 1,
    });

    expect(engine._hasAnimaOnField("Alice", game)).toBe(true);
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
