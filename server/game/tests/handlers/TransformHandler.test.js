import { setupGameWithHands, deployUnit } from "../utils.js";
import TransformHandler from "../../handlers/TransformHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("TransformHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new TransformHandler();
  });

  test("reverts a unit, preserving position", () => {
    const game = setupGameWithHands({ Alice: ["Khun Ran - Evolved"] });
    const unit = deployUnit(game, "Alice", "Khun Ran - Evolved", "fisherman");

    const result = handler.execute(
      { sourceUnit: unit, sourceId: unit.id, cardName: "Khun Ran" },
      context(game),
      game
    );

    expect(result.transformed).toBe(true);
    expect(unit.card.name).toBe("Khun Ran");
    expect(unit.placedPositionCode).toBe("fisherman");
  });

  test("throws when the target card name does not exist", () => {
    const game = setupGameWithHands({ Alice: ["Bull"] });
    const unit = deployUnit(game, "Alice", "Bull", "frontline-shinheuh");

    expect(() => handler.execute(
      { sourceUnit: unit, sourceId: unit.id, cardName: "Does Not Exist" },
      context(game),
      game
    )).toThrow("no unit card named");
  });

  test("no-op when the source unit is missing", () => {
    const game = setupGameWithHands({ Alice: ["Bull"] });
    expect(handler.execute({ sourceId: "Unit#Missing", cardName: "Khun Ran" }, context(game), game))
      .toEqual({ transformed: false });
  });

  test("validate throws without cardName", () => {
    expect(() => handler.validate({})).toThrow("cardName");
  });
});
