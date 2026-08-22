import { setupGameWithHands, deployUnit } from "../utils.js";
import RemoveTraitsHandler from "../../handlers/RemoveTraitsHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("RemoveTraitsHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new RemoveTraitsHandler();
  });

  test("removes all traits from a target", () => {
    const game = setupGameWithHands({ Bob: ["_Test Unit"] });
    const unit = deployUnit(game, "Bob", "_Test Unit", "fisherman");

    // _Test Unit has many native traits.
    expect(game.modifierStack.getActiveKeys(unit.id, "trait").size).toBeGreaterThan(0);

    const result = handler.execute({ targetId: unit.id }, context(game), game);

    expect(result.removed.length).toBeGreaterThan(0);
    expect(game.modifierStack.getActiveKeys(unit.id, "trait").size).toBe(0);
  });

  test("removes only a named trait", () => {
    const game = setupGameWithHands({ Bob: ["_Test Unit"] });
    const unit = deployUnit(game, "Bob", "_Test Unit", "fisherman");
    expect(game.modifierStack.has(unit.id, "trait", "barrier")).toBe(true);

    handler.execute({ targetId: unit.id, trait: "barrier" }, context(game), game);

    expect(game.modifierStack.has(unit.id, "trait", "barrier")).toBe(false);
    // Other traits remain.
    expect(game.modifierStack.getActiveKeys(unit.id, "trait").size).toBeGreaterThan(0);
  });

  test("validate throws without targetId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
  });
});
