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
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  ZoneService.addToHand(game.playerStates[username], card);
  return card;
}

function addCardToDeck(game, username, cardName) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  game.playerStates[username].deck.push(card);
  return card;
}

describe("SummonHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new SummonHandler();
  });

  test("summons a named unit from the hand onto the acting player's field", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Shinheuh" }, from: "hand", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").some((u) => u.card.name === "Test Shinheuh")).toBe(true);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Shinheuh")).toBe(false);
  });

  test("summons a random Shinheuh from the game catalog", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    const result = handler.execute(
      { owner: "Alice", card: { position: ["frontline-shinheuh", "backline-shinheuh"], cost: 3, random: true }, from: "game", onto: "self" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").some((u) => u.card.name === "Test Shinheuh")).toBe(true);
  });

  test("random summon is deterministic for the same seed", () => {
    const run = () => {
      const game = setupGameWithHands({ Alice: [] });
      handler.execute(
        { owner: "Alice", card: { position: ["frontline-shinheuh", "backline-shinheuh"], random: true }, from: "game", onto: "self" },
        context(game),
        game
      );
      return onField(game, "Alice").map((u) => u.card.name);
    };

    expect(run()).toEqual(run());
  });

  test("a summoned duplicate of an existing unit is discarded", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    deployUnit(game, "Alice", "Test Shinheuh", "frontline-shinheuh");
    addCardToHand(game, "Alice", "Test Shinheuh");

    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Shinheuh" }, from: "hand", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").filter((u) => u.card.name === "Test Shinheuh")).toHaveLength(1);
    expect(game.playerStates.Alice.discard.some((c) => c.name === "Test Shinheuh")).toBe(true);
  });

  test("no matching card is a no-op", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    const result = handler.execute(
      { owner: "Alice", card: { name: "Does Not Exist" }, from: "hand", onto: "self" },
      context(game),
      game
    );
    expect(result.summoned).toBe(false);
  });

  test("summons a named unit from the deck", () => {
    const game = setupGameWithHands({ Alice: [] });
    game.playerStates.Alice.deck = [];
    addCardToDeck(game, "Alice", "Test Shinheuh");

    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Shinheuh" }, from: "deck", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").some((u) => u.card.name === "Test Shinheuh")).toBe(true);
    expect(game.playerStates.Alice.deck.some((c) => c.name === "Test Shinheuh")).toBe(false);
  });

  test("summons a named unit onto the opponent", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });

    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Shinheuh" }, from: "hand", onto: "opponent", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    const summoned = onField(game, "Bob").find((u) => u.card.name === "Test Shinheuh");
    expect(summoned).toBeDefined();
    expect(summoned.owner).toBe("Bob");
  });

  test("summons onto both players from deck_or_hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    addCardToDeck(game, "Alice", "Test Shinheuh");

    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Shinheuh" }, from: "deck_or_hand", onto: "both", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(onField(game, "Alice").some((u) => u.card.name === "Test Shinheuh")).toBe(true);
    expect(onField(game, "Bob").some((u) => u.card.name === "Test Shinheuh")).toBe(true);
  });

  test("summon into a full line defers to a line_overflow decision", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    game.playerStates.Alice.field.frontline = [
      { id: "U1", card: { name: "A", maxHp: 1 }, currentHp: 1 },
      { id: "U2", card: { name: "B", maxHp: 1 }, currentHp: 1 },
      { id: "U3", card: { name: "C", maxHp: 1 }, currentHp: 1 },
      { id: "U4", card: { name: "D", maxHp: 1 }, currentHp: 1 },
      { id: "U5", card: { name: "E", maxHp: 1 }, currentHp: 1 },
    ];

    handler.execute(
      { owner: "Alice", card: { name: "Test Shinheuh" }, from: "hand", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(game.pendingDecision?.type).toBe("line_overflow");
  });

  test("summon of a multi-position card defers to a position_selection decision", () => {
    const game = setupGameWithHands({ Alice: ["Test Multi Position"] });

    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Multi Position" }, from: "hand", onto: "self", sourceId: "Unit#Src" },
      context(game),
      game
    );

    expect(result.summoned).toBe(true);
    expect(result.results[0].pending).toBe(true);
    expect(game.pendingDecision.type).toBe("position_selection");
    expect(game.pendingDecision.candidates.map((c) => c.id).sort())
      .toEqual(["fisherman", "spear-bearer"]);
  });

  test("validate throws without required fields", () => {
    expect(() => handler.validate({})).toThrow("owner");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("card");
    expect(() => handler.validate({ owner: "Alice", card: {} })).toThrow("from");
    expect(() => handler.validate({ owner: "Alice", card: {}, from: "game" })).toThrow("onto");
  });
});
