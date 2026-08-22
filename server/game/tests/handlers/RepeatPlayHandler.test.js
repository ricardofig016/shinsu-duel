import { setupGameWithCardsInHand } from "../utils.js";
import RepeatPlayHandler from "../../handlers/RepeatPlayHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("RepeatPlayHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new RepeatPlayHandler();
  });

  test("queues extra plays and consumes them on the next play", () => {
    const game = setupGameWithCardsInHand(["Baang"]);

    const result = handler.execute(
      { owner: "Alice", cardName: "Baang", amount: 4 },
      context(game),
      game
    );

    expect(result.queued).toBe(true);
    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(4);
    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(0);
  });

  test("queues are cleared on turn end", () => {
    const game = setupGameWithCardsInHand(["Baang"]);
    handler.execute({ owner: "Alice", cardName: "Baang", amount: 4 }, context(game), game);

    game.endTurn();

    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(0);
  });

  test("queues a wildcard repeat when cardName is omitted", () => {
    const game = setupGameWithCardsInHand(["Baang"]);

    handler.execute({ owner: "Alice", amount: 1 }, context(game), game);

    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(1);
    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(0);
  });

  test("a wildcard repeat applies to any next card", () => {
    const game = setupGameWithCardsInHand(["Baang"]);

    handler.execute({ owner: "Alice", amount: 2 }, context(game), game);

    expect(game.consumeRepeatPlays("Alice", "Bull")).toBe(2);
  });

  test("a named repeat and a wildcard repeat stack for the same card", () => {
    const game = setupGameWithCardsInHand(["Baang"]);

    handler.execute({ owner: "Alice", cardName: "Baang", amount: 2 }, context(game), game);
    handler.execute({ owner: "Alice", amount: 3 }, context(game), game);

    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(5);
    expect(game.consumeRepeatPlays("Alice", "Baang")).toBe(0);
  });

  test("validate throws without owner or amount", () => {
    expect(() => handler.validate({})).toThrow("owner");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("amount");
    expect(() => handler.validate({ owner: "Alice", cardName: "Baang", amount: 0 })).toThrow("amount");
  });
});
