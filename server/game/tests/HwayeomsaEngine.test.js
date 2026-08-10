import GameState from "../GameState.js";
import HwayeomsaEngine from "../attributes/HwayeomsaEngine.js";
import { setupGameWithCardsInHand } from "./utils.js";

describe("HwayeomsaEngine", () => {
  let game, engine;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa"]);
    game._attributeRegistry.register("hwayeomsa", new HwayeomsaEngine(game.eventBus, GameState.cards));
    engine = game._attributeRegistry.get("hwayeomsa");
  });

  test("initial fire charges are 0", () => {
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("onDeploy initializes fire charges if undefined", () => {
    delete game.playerStates.Alice.fireCharges;
    const unit = { owner: "Alice", card: { attributes: ["hwayeomsa"] } };
    engine.onDeploy(unit, game);
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("generateFireCharge fails when no Hwayeomsa on field", () => {
    const result = engine.generateFireCharge("Alice", game);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("No Hwayeomsa on field");
  });

  test("generateFireCharge spends shinsu, gains charge", () => {
    // Deploy Yeon Yihwa (Hwayeomsa)
    game.round = 6;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 6, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 1, recharged: 0 };

    const result = engine.generateFireCharge("Alice", game);
    expect(result.success).toBe(true);
    expect(game.playerStates.Alice.fireCharges).toBe(1);
  });

  test("getAvailableLevels returns levels based on charges", () => {
    game.playerStates.Alice.fireCharges = 3;
    const levels = engine.getAvailableLevels("Alice", game);
    expect(levels.map((l) => l.level)).toEqual([1, 2]);
  });

  test("getAvailableLevels empty when no charges", () => {
    game.playerStates.Alice.fireCharges = 0;
    const levels = engine.getAvailableLevels("Alice", game);
    expect(levels).toEqual([]);
  });

  test("consumeCharges creates Incinerate card in hand", () => {
    game.playerStates.Alice.hand = [];
    game.playerStates.Alice.fireCharges = 5;
    const result = engine.consumeCharges("Alice", 3, game);

    expect(result).not.toBeNull();
    expect(result.name).toBe("Incinerate III");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
    expect(game.playerStates.Alice.hand.length).toBe(1);
    expect(game.playerStates.Alice.hand[0].name).toBe("Incinerate III");
  });

  test("consumeCharges returns null for insufficient charges", () => {
    game.playerStates.Alice.fireCharges = 1;
    const result = engine.consumeCharges("Alice", 4, game);
    expect(result).toBeNull();
    expect(game.playerStates.Alice.fireCharges).toBe(1);
  });
});
