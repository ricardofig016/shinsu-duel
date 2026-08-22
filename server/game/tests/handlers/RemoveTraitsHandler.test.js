import { setupGameWithHands, deployUnit } from "../utils.js";
import RemoveTraitsHandler from "../../handlers/RemoveTraitsHandler.js";
import EVT from "../../EventCatalog.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("RemoveTraitsHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new RemoveTraitsHandler();
  });

  test("removes all traits from a target", () => {
    const game = setupGameWithHands({ Bob: ["Test Trait Unit"] });
    const unit = deployUnit(game, "Bob", "Test Trait Unit", "fisherman");

    // Test Trait Unit has many native traits.
    expect(game.modifierStack.getActiveKeys(unit.id, "trait").size).toBeGreaterThan(0);

    const result = handler.execute({ targetId: unit.id }, context(game), game);

    expect(result.removed.length).toBeGreaterThan(0);
    expect(game.modifierStack.getActiveKeys(unit.id, "trait").size).toBe(0);
  });

  test("removes only a named trait", () => {
    const game = setupGameWithHands({ Bob: ["Test Trait Unit"] });
    const unit = deployUnit(game, "Bob", "Test Trait Unit", "fisherman");
    expect(game.modifierStack.has(unit.id, "trait", "barrier")).toBe(true);

    handler.execute({ targetId: unit.id, trait: "barrier" }, context(game), game);

    expect(game.modifierStack.has(unit.id, "trait", "barrier")).toBe(false);
    // Other traits remain.
    expect(game.modifierStack.getActiveKeys(unit.id, "trait").size).toBeGreaterThan(0);
  });

  test("emits UNIT_SILENCED with the removed traits", () => {
    const game = setupGameWithHands({ Bob: ["Test Trait Unit"] });
    const unit = deployUnit(game, "Bob", "Test Trait Unit", "fisherman");
    const silenced = [];
    game.eventBus.on(EVT.UNIT_SILENCED, (p) => silenced.push(p), { phase: "post" });

    const result = handler.execute({ targetId: unit.id }, context(game), game);

    expect(silenced).toHaveLength(1);
    expect(silenced[0].targetId).toBe(unit.id);
    expect(silenced[0].removed.length).toBe(result.removed.length);
  });

  test("validate throws without targetId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
  });
});
