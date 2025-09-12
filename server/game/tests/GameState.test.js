import GameState from "../GameState.js";

const ROOM_CODE = "TEST";
const USERNAMES = ["Alice", "Bob"];

function advanceToRound(game, round) {
  const firstPlayer = game.currentTurn;
  const secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
  let safety = 0;
  while (game.round < round) {
    if (++safety > 1000) throw new Error("advanceToRound safety limit hit");
    game.processAction({ type: "pass-turn", username: firstPlayer });
    game.processAction({ type: "pass-turn", username: secondPlayer });
  }
}

function expectShinsuState(playerState, normalSpent, normalAvailable, recharged) {
  expect(playerState.shinsu.normalSpent).toBe(normalSpent);
  expect(playerState.shinsu.normalAvailable).toBe(normalAvailable);
  expect(playerState.shinsu.recharged).toBe(recharged);
}

describe.each([1, 3, 10, 25])("core rules at round %i", (round) => {
  let game, firstPlayer, secondPlayer;

  beforeEach(() => {
    game = new GameState(ROOM_CODE, USERNAMES);
    firstPlayer = game.currentTurn;
    secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
    advanceToRound(game, round);
  });

  test(`game.round should be ${round}`, () => {
    expect(game.round).toBe(round);
  });

  test("round increments after both players pass their turn", () => {
    game.processAction({ type: "pass-turn", username: firstPlayer }); // Alice -> Bob
    game.processAction({ type: "pass-turn", username: secondPlayer }); // Bob -> round should increment
    expect(game.round).toBe(round + 1);
  });

  test("turn alternates between players", () => {
    expect(game.currentTurn).toBe(firstPlayer);
    game.processAction({ type: "pass-turn", username: firstPlayer });
    expect(game.currentTurn).toBe(secondPlayer);
    game.processAction({ type: "pass-turn", username: secondPlayer });
    expect(game.currentTurn).toBe(firstPlayer);
  });

  test("amount of shinsu", () => {
    const aliceState = game.getClientState("Alice").you;
    const bobState = game.getClientState("Bob").you;
    const sumOfAllUnspentShinsu = ((game.round - 1) * (game.round - 1 + 1)) / 2;
    const expectedRecharged = Math.min(sumOfAllUnspentShinsu, game.MAX_RECHARGED_SHINSU);
    const expectedNormalAvailable = Math.min(game.round, game.MAX_NORMAL_SHINSU);
    expectShinsuState(aliceState, 0, expectedNormalAvailable, expectedRecharged);
    expectShinsuState(bobState, 0, expectedNormalAvailable, expectedRecharged);
  });

  test("number of cards in hand", () => {
    const aliceState = game.getClientState("Alice").you;
    const bobState = game.getClientState("Bob").you;
    const expectedHandSize = game.INIT_HAND_SIZE + (game.round - 1);
    expect(aliceState.hand.length).toBe(expectedHandSize);
    expect(bobState.hand.length).toBe(expectedHandSize);
  });

  test("number of cards in deck", () => {
    const aliceState = game.getClientState("Alice").you;
    const bobState = game.getClientState("Bob").you;
    const expectedDeckSize = game.INIT_DECK_SIZE - (game.INIT_HAND_SIZE + (game.round - 1));
    expect(aliceState.deckSize).toBe(expectedDeckSize);
    expect(bobState.deckSize).toBe(expectedDeckSize);
  });
});

function buildFilledDeck(cardId, count = 30) {
  return Array.from({ length: count }, () => cardId);
}

describe("deck behavior", () => {
  test("constructor accepts custom decks and draws initial hand from deck (pop semantics)", () => {
    const aliceDeck = [...Array.from({ length: 26 }, () => 0), 1, 1, 1, 1]; // 26 zeros then 4 ones for Alice
    const bobDeck = buildFilledDeck(0); // all zeros for Bob

    const decks = { Alice: aliceDeck, Bob: bobDeck };
    const game = new GameState(ROOM_CODE, USERNAMES, decks);

    // After constructor, initial hand size is INIT_HAND_SIZE
    const aliceClient = game.getClientState("Alice").you;
    expect(aliceClient.hand.length).toBe(game.INIT_HAND_SIZE);

    // Because draw uses pop(), Alice's hand should contain the four 1's we placed at the end
    const aliceHandIds = aliceClient.hand.map((c) => c.id);
    expect(aliceHandIds).toEqual([1, 1, 1, 1]);

    // Deck size decreased by INIT_HAND_SIZE
    expect(aliceClient.deckSize).toBe(game.INIT_DECK_SIZE - game.INIT_HAND_SIZE);

    // Bob also should have a reduced deck and 4 cards in hand
    const bobClient = game.getClientState("Bob").you;
    expect(bobClient.hand.length).toBe(game.INIT_HAND_SIZE);
    expect(bobClient.deckSize).toBe(game.INIT_DECK_SIZE - game.INIT_HAND_SIZE);
  });

  test("getClientState.deckSize matches internal deck length", () => {
    const decks = { Alice: buildFilledDeck(0), Bob: buildFilledDeck(0) };
    const game = new GameState(ROOM_CODE, USERNAMES, decks);

    const aliceClient = game.getClientState("Alice").you;
    expect(aliceClient.deckSize).toBe(game.playerStates.Alice.deck.length);
  });

  test("constructor throws for invalid deck length (too short)", () => {
    // Alice deck has wrong length
    const badAliceDeck = Array.from({ length: 29 }, () => 0);
    const decks = { Alice: badAliceDeck, Bob: buildFilledDeck(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks)).toThrow(/deck must be an array of/);
  });

  test("constructor throws for invalid deck length (too long)", () => {
    // Alice deck has wrong length
    const badAliceDeck = Array.from({ length: 31 }, () => 0);
    const decks = { Alice: badAliceDeck, Bob: buildFilledDeck(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks)).toThrow(/deck must be an array of/);
  });

  test("constructor throws for invalid card id", () => {
    // Use a clearly invalid card id (very large)
    const invalidCardId = 999999;
    const badDeck = Array.from({ length: 30 }, () => invalidCardId);
    const decks = { Alice: badDeck, Bob: buildFilledDeck(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks)).toThrow(/does not exist/);
  });

  test("drawing when deck is empty does not crash and does not increase hand", () => {
    const decks = { Alice: buildFilledDeck(0), Bob: buildFilledDeck(0) };
    const game = new GameState(ROOM_CODE, USERNAMES, decks);

    // Simulate Alice's deck becoming empty
    game.playerStates.Alice.deck = [];
    const handBefore = game.getClientState("Alice").you.hand;

    // Force an end-of-round draw by making both players pass
    // Determine current players for safe calls
    const first = game.currentTurn;
    const second = first === "Alice" ? "Bob" : "Alice";
    game.processAction({ type: "pass-turn", username: first });
    game.processAction({ type: "pass-turn", username: second });

    const handAfter = game.getClientState("Alice").you.hand;
    expect(handAfter).toEqual(handBefore); // no new cards since deck was empty
  });
});
