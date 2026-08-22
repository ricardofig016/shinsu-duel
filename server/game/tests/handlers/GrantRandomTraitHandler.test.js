import { setupGameWithCardsInHand } from "../utils.js";
import GrantRandomTraitHandler from "../../handlers/GrantRandomTraitHandler.js";
import traits from "../../../data/traits.json" with { type: "json" };

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

function deploy(game, username, cardName, positionCode) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "deploy-unit-action", data: { source: "player", username, handId, placedPositionCode: positionCode } });
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline]
    .find((u) => u.card.name === cardName);
}

describe("GrantRandomTraitHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new GrantRandomTraitHandler();
  });

  test("grants a random numeric trait", () => {
    const game = setupGameWithCardsInHand(["Bull", "Bull"]);
    const unit = deploy(game, "Alice", "Bull", "frontline-shinheuh");

    const result = handler.execute(
      { targetId: unit.id, numeric: true, sourceId: "Ability#1", sourceType: "unit" },
      context(game),
      game
    );

    expect(result.granted).toBe(true);
    expect(traits[result.trait].numeric).toBe(true);
    expect(game.modifierStack.has(unit.id, "trait", result.trait)).toBe(true);
  });

  test("grants any random trait when numeric is omitted", () => {
    const game = setupGameWithCardsInHand(["Bull", "Bull"]);
    const unit = deploy(game, "Alice", "Bull", "frontline-shinheuh");

    const result = handler.execute(
      { targetId: unit.id, sourceId: "Ability#1" },
      context(game),
      game
    );

    expect(result.granted).toBe(true);
    expect(game.modifierStack.has(unit.id, "trait", result.trait)).toBe(true);
  });

  test("validate throws without targetId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
  });
});
