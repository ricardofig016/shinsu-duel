import { jest } from "@jest/globals";
import { createTestGame, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";
import CompressionService from "../../services/CompressionService.js";
import EVT from "../../EventCatalog.js";

describe("CompressionService", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  test("compress reduces card cost and emits shinsu:compressed", () => {
    const [owner] = game.usernames;
    const cardId = getCardIdByName("Fiery Elephant");
    const card = new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);

    expect(card.costReduction).toBe(0);

    const context = { emitChild: jest.fn() };
    const result = CompressionService.compress(card, 2, context);

    expect(result.compressed).toBe(2);
    expect(card.costReduction).toBe(2);
    expect(context.emitChild).toHaveBeenCalledWith(EVT.SHINSU_COMPRESSED, expect.objectContaining({
      amount: 2,
      totalReduction: 2,
    }));
  });

  test("compress stacks additively on same card", () => {
    const [owner] = game.usernames;
    const cardId = getCardIdByName("Fiery Elephant");
    const card = new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);

    const ctx = { emitChild: jest.fn() };
    CompressionService.compress(card, 2, ctx);
    CompressionService.compress(card, 3, ctx);

    expect(card.costReduction).toBe(5);
  });

  test("clearReduction resets to 0", () => {
    const [owner] = game.usernames;
    const cardId = getCardIdByName("Fiery Elephant");
    const card = new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);

    const ctx = { emitChild: jest.fn() };
    CompressionService.compress(card, 4, ctx);
    CompressionService.clearReduction(card);

    expect(card.costReduction).toBe(0);
  });

  test("throws for missing card", () => {
    expect(() => CompressionService.compress(null, 2)).toThrow("card is required");
  });

  test("throws for non-positive amount", () => {
    const [owner] = game.usernames;
    const cardId = getCardIdByName("Fiery Elephant");
    const card = new Card(cardId, game.constructor.cards[cardId], owner, game.eventBus);

    expect(() => CompressionService.compress(card, 0)).toThrow("positive");
    expect(() => CompressionService.compress(card, -1)).toThrow("positive");
  });
});
