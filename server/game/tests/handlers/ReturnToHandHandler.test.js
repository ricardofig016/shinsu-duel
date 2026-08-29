import { setupGameWithHands, deployUnit } from "../utils.js";
import ReturnToHandHandler from "../../handlers/ReturnToHandHandler.js";

describe("ReturnToHandHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new ReturnToHandHandler();
  });

  test("validate requires targetId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
    expect(() => handler.validate({ targetId: "Unit#1" })).not.toThrow();
  });

  test("returns the target unit to its owner's hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");

    const result = handler.execute({ targetId: unit.id }, {}, game);

    expect(result.returned).toBe(true);
    expect(game._findUnit(unit.id)).toBeNull();
    expect(game.playerStates.Alice.hand).toContain(unit.card);
  });

  test("a unit that is not on the field is not returned", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");

    expect(handler.execute({ targetId: "Unit#Missing" }, {}, game)).toEqual({ returned: false });

    handler.execute({ targetId: unit.id }, {}, game);
    expect(handler.execute({ targetId: unit.id }, {}, game)).toEqual({ returned: false });
    expect(game.playerStates.Alice.hand.filter((c) => c.name === "Test Returner")).toHaveLength(1);
  });
});
