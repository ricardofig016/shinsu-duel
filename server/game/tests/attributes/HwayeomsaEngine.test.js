import HwayeomsaEngine from "../../attributes/HwayeomsaEngine.js";
import { setupGameWithCardsInHand } from "../utils.js";

describe("HwayeomsaEngine", () => {
  let game, engine;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Test Hwayeomsa", "Test Hwayeomsa", "Test Hwayeomsa", "Test Hwayeomsa"]);
    game._attributeRegistry.register("hwayeomsa", new HwayeomsaEngine(game.eventBus, game.cards));
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
    // Deploy Test Hwayeomsa (Hwayeomsa)
    game.round = 6;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 6, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 1, recharged: 0 };

    const result = engine.generateFireCharge("Alice", game);
    expect(result.success).toBe(true);
    expect(game.playerStates.Alice.fireCharges).toBe(1);
  });

  test("generateFireCharge fails when out of shinsu", () => {
    game.round = 6;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 6, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.currentTurn = "Alice";
    // Drain shinsu after deploying.
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 0, recharged: 0 };

    const result = engine.generateFireCharge("Alice", game);
    expect(result.success).toBe(false);
    expect(result.reason).toBe("Not enough shinsu");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("generateFireCharge does not duplicate Fire Core in hand", () => {
    game.round = 6;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 6, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 0 };

    const first = engine.generateFireCharge("Alice", game);
    const firstFireCores = game.playerStates.Alice.hand.filter((c) => c.name === "Fire Core").length;
    const second = engine.generateFireCharge("Alice", game);
    const secondFireCores = game.playerStates.Alice.hand.filter((c) => c.name === "Fire Core").length;

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(firstFireCores).toBe(1);
    expect(secondFireCores).toBe(1);
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
    expect(result.name).toBe("Test Incinerate III");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
    expect(game.playerStates.Alice.hand.length).toBe(1);
    expect(game.playerStates.Alice.hand[0].name).toBe("Test Incinerate III");
  });

  test("consumeCharges returns null for insufficient charges", () => {
    game.playerStates.Alice.fireCharges = 1;
    const result = engine.consumeCharges("Alice", 4, game);
    expect(result).toBeNull();
    expect(game.playerStates.Alice.fireCharges).toBe(1);
  });

  test("consumeCharges returns null for an unknown level", () => {
    game.playerStates.Alice.fireCharges = 10;
    const result = engine.consumeCharges("Alice", 99, game);
    expect(result).toBeNull();
    expect(game.playerStates.Alice.fireCharges).toBe(10);
  });

  test("consumeCharges returns null for a missing card definition", () => {
    game.playerStates.Alice.fireCharges = 5;
    const noCards = new HwayeomsaEngine(game.eventBus, {});
    const result = noCards.consumeCharges("Alice", 1, game);
    expect(result).toBeNull();
  });

  test("consumeCharges returns null for an unknown player", () => {
    const result = engine.consumeCharges("Nobody", 1, game);
    expect(result).toBeNull();
  });
});
