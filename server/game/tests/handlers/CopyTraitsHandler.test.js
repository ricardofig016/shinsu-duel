import { setupGameWithCardsInHand } from "../utils.js";
import CopyTraitsHandler from "../../handlers/CopyTraitsHandler.js";

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

describe("CopyTraitsHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new CopyTraitsHandler();
  });

  test("copies every active trait from the source onto the target", () => {
    const game = setupGameWithCardsInHand(["Test Trait Unit", "Test Shinheuh", "Test Trait Unit", "Test Shinheuh"]);
    const source = deploy(game, "Alice", "Test Trait Unit", "fisherman");
    const target = deploy(game, "Alice", "Test Shinheuh", "frontline-shinheuh");

    expect(game.modifierStack.getActiveKeys(target.id, "trait").size).toBe(0);

    const result = handler.execute(
      { targetId: target.id, sourceUnitId: source.id, sourceId: "Passive#1", sourceType: "passive" },
      context(game),
      game
    );

    expect(result.copied).toBeGreaterThan(0);
    const sourceKeys = [...game.modifierStack.getActiveKeys(source.id, "trait")];
    for (const key of sourceKeys) {
      expect(game.modifierStack.has(target.id, "trait", key)).toBe(true);
    }
  });

  test("no-op when source or target is missing", () => {
    const game = setupGameWithCardsInHand(["Test Shinheuh"]);
    expect(handler.execute({ targetId: "Unit#T", sourceUnitId: "Unit#S", sourceId: "P" }, context(game), game))
      .toEqual({ copied: 0 });
  });

  test("validate throws without targetId or sourceUnitId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
    expect(() => handler.validate({ targetId: "T" })).toThrow("sourceUnitId");
  });
});
