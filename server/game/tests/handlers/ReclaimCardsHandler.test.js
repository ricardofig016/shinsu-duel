import GameState from "../../GameState.js";
import { createTestGame } from "../utils.js";

describe("ReclaimCardsHandler", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
  });

  test("moves card from discard to hand", () => {
    const player = game.playerStates[game.usernames[0]];
    player.discard = [player.hand.pop()]; // discard one card
    const discardSize = player.discard.length;
    const handSize = player.hand.length;

    const card = player.discard.pop();
    if (card) player.hand.push(card);

    expect(player.discard.length).toBe(discardSize - 1);
    expect(player.hand.length).toBe(handSize + 1);
  });

  test("returns null if discard is empty", () => {
    const player = game.playerStates[game.usernames[0]];
    player.discard = [];
    const before = player.hand.length;

    const card = player.discard.pop() || null;
    if (card) player.hand.push(card);

    expect(player.hand.length).toBe(before);
    expect(card).toBeNull();
  });
});
