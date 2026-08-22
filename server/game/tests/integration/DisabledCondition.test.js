import { setupGameWithCardsInHand, advanceToRound } from "../utils.js";

describe("Disabled condition", () => {
  test("condition persists and is cleaned at round end", () => {
    const game = setupGameWithCardsInHand(["Test Trait Unit"]);
    advanceToRound(game, 2);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];

    game.modifierStack.apply({ sourceId: "s", sourceType: "system", targetId: unit.id, type: "condition", key: "disabled", value: 1 });
    expect(game.modifierStack.has(unit.id, "condition", "disabled")).toBe(true);

    // End round
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    expect(game.modifierStack.has(unit.id, "condition", "disabled")).toBe(false);
  });

  test("Disabled does not remove traits", () => {
    const game = setupGameWithCardsInHand(["Test Trait Unit"]);
    advanceToRound(game, 2);
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    const unit = game.playerStates.Alice.field.frontline[0];

    game.modifierStack.apply({ sourceId: "s", sourceType: "system", targetId: unit.id, type: "condition", key: "disabled", value: 1 });
    expect(game.modifierStack.has(unit.id, "trait", "barrier")).toBe(true);
    expect(game.modifierStack.has(unit.id, "trait", "strong")).toBe(true);
  });
});
