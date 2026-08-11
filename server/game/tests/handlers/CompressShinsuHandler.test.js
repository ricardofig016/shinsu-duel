import { jest } from "@jest/globals";
import EVT from "../../EventCatalog.js";
import Card from "../../Card.js";
import CompressShinsuHandler from "../../handlers/CompressShinsuHandler.js";
import { resolveCardTarget } from "../../TargetResolver.js";
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

    expect(result).toEqual(expect.objectContaining({ totalReduction: 2 }));
    expect(target.costReduction).toBe(2);
    expect(untouched.costReduction).toBe(0);
    expect(context.emitChild).toHaveBeenCalledWith(EVT.SHINSU_COMPRESSED, expect.objectContaining({
      targetCardId: target.id,
      amount: 2,
    }));
  });

  test("selector resolution is done by TargetResolver, handler receives concrete targetCardId", () => {
    const [owner] = game.usernames;
    game.playerStates[owner].hand = [];
    const namedTarget = addCardToHand(game, owner, "Fiery Elephant");
    const hwayeomsaTarget = addCardToHand(game, owner, "Yeon Yihwa");

    // Selectors are resolved by TargetResolver.resolveCardTarget before
    // the handler is invoked (this is what EffectResolver does).
    const nameCardId = resolveCardTarget(game.playerStates[owner], "Fiery Elephant");
    const attrCardId = resolveCardTarget(game.playerStates[owner], "a Hwayeomsa");

    expect(nameCardId).toBe(namedTarget.id);
    expect(attrCardId).toBe(hwayeomsaTarget.id);

    // Handler receives only concrete targetCardId.
    handler.execute({ owner, amount: 1, targetCardId: nameCardId }, context, game);
    handler.execute({ owner, amount: 2, targetCardId: attrCardId }, context, game);

    expect(namedTarget.costReduction).toBe(1);
    expect(hwayeomsaTarget.costReduction).toBe(2);
  });

  test("TargetResolver resolves the most-expensive selector", () => {
    const [owner] = game.usernames;
    game.playerStates[owner].hand = [];
    const cheaper = addCardToHand(game, owner, "Fiery Elephant");
    const expensive = addCardToHand(game, owner, "The Workshop");

    const cardId = resolveCardTarget(game.playerStates[owner], "the most expensive card");
    expect(cardId).toBe(expensive.id);

    // Handler receives only concrete targetCardId.
    handler.execute({ owner, amount: 1, targetCardId: cardId }, context, game);

    expect(cheaper.costReduction).toBe(0);
    expect(expensive.costReduction).toBe(1);
  });

  test("validate rejects missing targetCardId", () => {
    expect(() => handler.validate({ owner: "Alice", amount: 1 }, context))
      .toThrow(/targetCardId/i);
  });

  test("execute rejects when the pre-resolved card is no longer in hand", () => {
    const [owner] = game.usernames;
    game.playerStates[owner].hand = [];
    const target = addCardToHand(game, owner, "Fiery Elephant");
    const cardId = target.id;

    // Remove the card from hand (simulates a race condition)
    game.playerStates[owner].hand = [];

    expect(() => handler.execute({ owner, amount: 1, targetCardId: cardId }, context, game))
      .toThrow(/no longer in/i);
  });
});
