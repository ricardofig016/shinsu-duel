import { jest } from "@jest/globals";
import EVT from "../../EventCatalog.js";
import Card from "../../Card.js";
import CompressShinsuHandler from "../../handlers/CompressShinsuHandler.js";
import { createTestGame, getCardIdByName } from "../utils.js";

function addCardToHand(game, username, name) {
  const cardId = getCardIdByName(name);
  const card = new Card(cardId, game.constructor.cards[cardId], username, game.eventBus);
  game.playerStates[username].hand.push(card);
  return card;
}

describe("CompressShinsuHandler", () => {
  let game;
  let handler;
  let context;

  beforeEach(() => {
    game = createTestGame();
    handler = new CompressShinsuHandler();
    context = { emitChild: jest.fn() };
  });

  test("reduces only the selected card instance's cost", () => {
    const [owner] = game.usernames;
    game.playerStates[owner].hand = [];
    const target = addCardToHand(game, owner, "Fiery Elephant");
    const untouched = addCardToHand(game, owner, "The Workshop");

    const result = handler.execute({ owner, amount: 2, targetCardId: target.id }, context, game);

    expect(result).toEqual(expect.objectContaining({ targetCardId: target.id, totalReduction: 2 }));
    expect(target.costReduction).toBe(2);
    expect(untouched.costReduction).toBe(0);
    expect(context.emitChild).toHaveBeenCalledWith(EVT.SHINSU_COMPRESSED, expect.objectContaining({
      targetCardId: target.id,
      amount: 2,
    }));
  });

  test("resolves canonical name and attribute selectors", () => {
    const [owner] = game.usernames;
    game.playerStates[owner].hand = [];
    const namedTarget = addCardToHand(game, owner, "Fiery Elephant");
    const hwayeomsaTarget = addCardToHand(game, owner, "Yeon Yihwa");

    handler.execute({ owner, amount: 1, targetCardSelector: "Fiery Elephant" }, context, game);
    handler.execute({ owner, amount: 2, targetCardSelector: "a Hwayeomsa" }, context, game);

    expect(namedTarget.costReduction).toBe(1);
    expect(hwayeomsaTarget.costReduction).toBe(2);
  });

  test("selects the highest printed cost for the canonical most-expensive selector", () => {
    const [owner] = game.usernames;
    game.playerStates[owner].hand = [];
    const cheaper = addCardToHand(game, owner, "Fiery Elephant");
    const expensive = addCardToHand(game, owner, "The Workshop");

    handler.execute({ owner, amount: 1, targetCardSelector: "the most expensive card" }, context, game);

    expect(cheaper.costReduction).toBe(0);
    expect(expensive.costReduction).toBe(1);
  });

  test("rejects compression without a selected hand card", () => {
    const [owner] = game.usernames;

    expect(() => handler.execute({ owner, amount: 1 }, context, game))
      .toThrow(/card in the owner's hand/i);
  });
});
