import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";
import SummonHandler from "../../handlers/SummonHandler.js";
import Card from "../../Card.js";
import ZoneService from "../../services/ZoneService.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

function onField(game, username) {
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline];
}

function addCardToHand(game, username, cardName) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.constructor.cards[cardId], username, game.eventBus);
  ZoneService.addToHand(game.playerStates[username], card);
  return card;
}

describe("SummonHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new SummonHandler();
  });

  test("summons a named unit from the hand onto the acting player's field", () => {
    const game = setupGameWithHands({ Alice: ["Bull"] });
    const result = handler.execute(
      { owner: "Alice", card: { name: "Bull" }, from: "hand", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").some((u) => u.card.name === "Bull")).toBe(true);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Bull")).toBe(false);
  });

  test("summons a random Shinheuh from the game catalog", () => {
    const game = setupGameWithHands({ Alice: ["Bull"] });
    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh", "backline-shinheuh"], cost: 3, random: true }, from: "game", onto: "self" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").some((u) => u.card.name === "Bull")).toBe(true);
  });

  test("a summoned duplicate of an existing unit is discarded", () => {
    const game = setupGameWithHands({ Alice: ["Bull"] });
    deployUnit(game, "Alice", "Bull", "frontline-shinheuh");
    addCardToHand(game, "Alice", "Bull");

    const result = handler.execute(
      { owner: "Alice", card: { name: "Bull" }, from: "hand", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").filter((u) => u.card.name === "Bull")).toHaveLength(1);
    expect(game.playerStates.Alice.discard.some((c) => c.name === "Bull")).toBe(true);
  });

  test("no matching card is a no-op", () => {
    const game = setupGameWithHands({ Alice: ["Bull"] });
    const result = handler.execute(
      { owner: "Alice", card: { name: "Does Not Exist" }, from: "hand", onto: "self" },
      context(game),
      game
    );
    expect(result.summoned).toBe(false);
  });

  test("validate throws without required fields", () => {
    expect(() => handler.validate({})).toThrow("owner");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("card");
    expect(() => handler.validate({ owner: "Alice", card: {} })).toThrow("from");
    expect(() => handler.validate({ owner: "Alice", card: {}, from: "game" })).toThrow("onto");
  });
});
