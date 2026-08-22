import { setupGameWithHands, deployUnit } from "../utils.js";
import StealHandler from "../../handlers/StealHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

function onField(game, username) {
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline];
}

describe("StealHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new StealHandler();
  });

  test("steals the enemy's cheapest Shinheuh onto the acting player's field", () => {
    const game = setupGameWithHands({ Bob: ["Bull"] });
    // Bob controls a Bull (cost 3) as a Shinheuh.
    const bull = deployUnit(game, "Bob", "Bull", "frontline-shinheuh");

    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh", "backline-shinheuh"], cost: "cheapest" }, sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.stolen).toBe(true);
    expect(onField(game, "Bob").some((u) => u.id === bull.id)).toBe(false);
    expect(onField(game, "Alice").some((u) => u.id === bull.id)).toBe(true);
    expect(bull.owner).toBe("Alice");
  });

  test("no-op when no enemy matches the descriptor", () => {
    const game = setupGameWithHands({ Bob: ["Bull"] });
    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh"], cost: 2 }, sourceId: "Unit#Src" },
      context(game),
      game
    );
    expect(result.stolen).toBe(false);
  });

  test("validate throws without owner or card", () => {
    expect(() => handler.validate({})).toThrow("owner");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("card");
  });
});
