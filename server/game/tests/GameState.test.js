import GameState from "../GameState.js";
import { jest } from "@jest/globals";

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

  test("getOpponentUsername returns correct opponent", () => {
    expect(game.getClientState(firstPlayer).opponent.username).toBe(secondPlayer);
    expect(game.getClientState(secondPlayer).opponent.username).toBe(firstPlayer);
  });

  test("getClientState returns correct structure", () => {
    const state = game.getClientState(firstPlayer);

    // Top-level keys
    expect(state).toHaveProperty("you");
    expect(state).toHaveProperty("opponent");
    expect(state).toHaveProperty("currentTurn");

    // 'you' and 'opponent' should have expected keys
    [
      "combatSlotCodes",
      "deckSize",
      "lighthouses",
      "field",
      "hand",
      "shinsu",
      "username",
      "passButton",
    ].forEach((key) => {
      expect(state.you).toHaveProperty(key);
      expect(state.opponent).toHaveProperty(key);
    });

    // Username values
    expect(state.you.username).toBe(firstPlayer);
    expect(state.opponent.username).toBe(secondPlayer);

    // Pass button structure
    expect(state.you.passButton).toHaveProperty("isEnabled");
    expect(state.you.passButton).toHaveProperty("text");
    expect(typeof state.you.passButton.isEnabled).toBe("boolean");
    expect(typeof state.you.passButton.text).toBe("string");

    // Field structure
    expect(state.you.field).toHaveProperty("frontline");
    expect(state.you.field).toHaveProperty("backline");
    expect(Array.isArray(state.you.field.frontline)).toBe(true);
    expect(Array.isArray(state.you.field.backline)).toBe(true);

    // Hand structure
    expect(Array.isArray(state.you.hand)).toBe(true);
    if (state.you.hand.length > 0) {
      expect(state.you.hand[0]).toHaveProperty("id");
      expect(state.you.hand[0]).toHaveProperty("traitCodes");
    }

    // Shinsu structure
    expect(state.you.shinsu).toHaveProperty("normalSpent");
    expect(state.you.shinsu).toHaveProperty("normalAvailable");
    expect(state.you.shinsu).toHaveProperty("recharged");
    expect(typeof state.you.shinsu.normalSpent).toBe("number");
    expect(typeof state.you.shinsu.normalAvailable).toBe("number");
    expect(typeof state.you.shinsu.recharged).toBe("number");
  });

  test("pass button is enabled only for current turn", () => {
    const youState = game.getClientState(firstPlayer).you;
    const opponentState = game.getClientState(firstPlayer).opponent;
    expect(youState.passButton.isEnabled).toBe(true);
    expect(opponentState.passButton.isEnabled).toBe(false);
  });

  test("invalid action type throws error", () => {
    expect(() => game.processAction({ type: "invalid-action", username: firstPlayer })).toThrow(
      /Invalid action type/
    );
  });

  test("invalid username throws error", () => {
    expect(() => game.processAction({ type: "pass-turn", username: "NotAPlayer" })).toThrow(
      /Invalid username/
    );
  });

  test("missing fields in action data throws error", () => {
    expect(() => game.processAction({ type: "deploy-unit", username: firstPlayer })).toThrow(
      /Missing fields/
    );
  });

  test("not your turn throws error", () => {
    expect(() => game.processAction({ type: "pass-turn", username: secondPlayer })).toThrow(/not your turn/);
  });
});

describe("deck behavior", () => {
  test("constructor accepts custom decks and draws initial hand from deck (pop semantics)", () => {
    const aliceDeck = [...Array.from({ length: 26 }, () => 0), 1, 1, 1, 1]; // 26 zeros then 4 ones for Alice
    const bobDeck = Array(30).fill(0); // all zeros for Bob

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
    const decks = { Alice: Array(30).fill(0), Bob: Array(30).fill(0) };
    const game = new GameState(ROOM_CODE, USERNAMES, decks);

    const aliceClient = game.getClientState("Alice").you;
    expect(aliceClient.deckSize).toBe(game.playerStates.Alice.deck.length);
  });

  test("constructor throws for invalid deck length (too short)", () => {
    // Alice deck has wrong length
    const badAliceDeck = Array.from({ length: 29 }, () => 0);
    const decks = { Alice: badAliceDeck, Bob: Array(30).fill(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks)).toThrow(/deck must be an array of/);
  });

  test("constructor throws for invalid deck length (too long)", () => {
    // Alice deck has wrong length
    const badAliceDeck = Array.from({ length: 31 }, () => 0);
    const decks = { Alice: badAliceDeck, Bob: Array(30).fill(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks)).toThrow(/deck must be an array of/);
  });

  test("constructor throws for invalid card id", () => {
    // Use a clearly invalid card id (very large)
    const invalidCardId = 999999;
    const badDeck = Array.from({ length: 30 }, () => invalidCardId);
    const decks = { Alice: badDeck, Bob: Array(30).fill(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks)).toThrow(/does not exist/);
  });

  test("drawing when deck is empty does not crash and does not increase hand", () => {
    const decks = { Alice: Array(30).fill(0), Bob: Array(30).fill(0) };
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

describe("place cards on field", () => {
  let game, firstPlayer;

  // Helper to create a game with specific cards in hand
  function setupGameWithCardsInHand(cardsInHand) {
    // Create decks with specific cards at the end for drawing into hand
    const deckCards = Array(26).fill(0);
    const fullDeck = [...deckCards, ...cardsInHand];
    const decks = {
      Alice: fullDeck,
      Bob: Array(30).fill(0),
    };

    const newGame = new GameState(ROOM_CODE, USERNAMES, decks, USERNAMES[0]);
    return newGame;
  }

  test("placing a scout unit puts it in the frontline", () => {
    // Ship is a scout (card id 4)
    const game = setupGameWithCardsInHand([4, 4, 4, 4]);

    // Deploy Ship as a scout
    game.processAction({
      type: "deploy-unit",
      username: USERNAMES[0],
      handId: 0,
      placedPositionCode: "scout",
    });

    // Check that the card is on the field in the frontline
    const playerState = game.playerStates[USERNAMES[0]];
    expect(playerState.field.frontline.length).toBe(1);
    expect(playerState.field.backline.length).toBe(0);
    expect(playerState.field.frontline[0].id).toBe(4); // Ship's ID
    expect(playerState.field.frontline[0].placedPositionCode).toBe("scout");
    expect(playerState.hand.length).toBe(3); // One card removed from hand
  });

  test("placing a lightbearer unit puts it in the backline", () => {
    // Rachel is a lightbearer (card id 6)
    const game = setupGameWithCardsInHand([6, 6, 6, 6]);

    // Deploy Rachel as a lightbearer
    game.processAction({
      type: "deploy-unit",
      username: USERNAMES[0],
      handId: 0,
      placedPositionCode: "lightbearer",
    });

    // Check that the card is on the field in the backline
    const playerState = game.playerStates[USERNAMES[0]];
    expect(playerState.field.backline.length).toBe(1);
    expect(playerState.field.frontline.length).toBe(0);
    expect(playerState.field.backline[0].id).toBe(6); // Rachel's id
    expect(playerState.field.backline[0].placedPositionCode).toBe("lightbearer");
    expect(playerState.hand.length).toBe(3); // One card removed from hand
  });

  test("deploying a unit costs shinsu", () => {
    // Evankell costs 8 shinsu (card id 5)
    const game = setupGameWithCardsInHand([5, 5, 5, 5]);

    // Fast-forward to round 6
    advanceToRound(game, 6);

    // Get initial shinsu state
    const initialShinsu = { ...game.playerStates[USERNAMES[0]].shinsu };

    // Deploy Evankell
    game.processAction({
      type: "deploy-unit",
      username: USERNAMES[0],
      handId: 0,
      placedPositionCode: "wavecontroller",
    });

    // Check that shinsu was spent
    const finalShinsu = game.playerStates[USERNAMES[0]].shinsu;
    const cardCost = 8; // Evankell's cost

    // The cost is first deducted from recharged shinsu, then from normal available
    const expectedRechargedSpent = Math.min(initialShinsu.recharged, cardCost);
    const expectedNormalSpent = cardCost - expectedRechargedSpent;

    expect(finalShinsu.recharged).toBe(initialShinsu.recharged - expectedRechargedSpent);
    expect(finalShinsu.normalAvailable).toBe(initialShinsu.normalAvailable - expectedNormalSpent);
    expect(finalShinsu.normalSpent).toBe(initialShinsu.normalSpent + expectedNormalSpent);
  });

  test("deploying a unit with multiple position options works for all valid positions", () => {
    // Evankhell (id 5) can be placed as wavecontroller or fisherman
    const game = setupGameWithCardsInHand([5, 5, 5, 5]);

    // Fast-forward to round 10
    advanceToRound(game, 10);

    // Try as fisherman first
    game.processAction({
      type: "deploy-unit",
      username: USERNAMES[0],
      handId: 0,
      placedPositionCode: "fisherman",
    });

    // Reset for second test with another game instance
    const game2 = setupGameWithCardsInHand([5, 5, 5, 5]);

    // Fast-forward to round 10
    advanceToRound(game2, 10);

    // Try as wavecontroller
    game2.processAction({
      type: "deploy-unit",
      username: USERNAMES[0],
      handId: 0,
      placedPositionCode: "wavecontroller",
    });

    // Both placements should succeed
    expect(game.playerStates[USERNAMES[0]].field.frontline[0].placedPositionCode).toBe("fisherman");
    expect(game2.playerStates[USERNAMES[0]].field.frontline[0].placedPositionCode).toBe("wavecontroller");
  });

  test("deploying a unit to invalid position throws error", () => {
    // Khun (id 2) is only a lightbearer, not a fisherman
    const game = setupGameWithCardsInHand([2, 2, 2, 2]);

    // Fast-forward to round 2
    advanceToRound(game, 2);

    // Should throw error when trying to place as fisherman
    expect(() =>
      game.processAction({
        type: "deploy-unit",
        username: USERNAMES[0],
        handId: 0,
        placedPositionCode: "fisherman",
      })
    ).toThrow(/Card cannot be placed in position/);
  });

  test("deploying a unit without enough shinsu throws error", () => {
    // Viole costs 3 shinsu (id 0), too much for round 1
    const game = setupGameWithCardsInHand([0, 0, 0, 0]);

    // Make sure it's round 1 with only 1 shinsu
    expect(game.round).toBe(1);

    // Should throw error when trying to deploy expensive unit
    expect(() =>
      game.processAction({
        type: "deploy-unit",
        username: USERNAMES[0],
        handId: 0,
        placedPositionCode: "wavecontroller",
      })
    ).toThrow(/Not enough shinsu/);
  });

  test("deploying a unit publishes events and switches turns", () => {
    // Add spy to monitor event publishing
    const game = setupGameWithCardsInHand([3, 3, 3, 3]);

    // Create spies on the event bus
    const publishSpy = jest.spyOn(game.eventBus, "publish");

    // Initial turn state
    expect(game.currentTurn).toBe(USERNAMES[0]);

    // Deploy Rak
    game.processAction({
      type: "deploy-unit",
      username: USERNAMES[0],
      handId: 0,
      placedPositionCode: "spearbearer",
    });

    // Check events were published
    expect(publishSpy).toHaveBeenCalledWith("OnDeployUnit", expect.any(Object));
    expect(publishSpy).toHaveBeenCalledWith("OnSummonUnit", expect.any(Object));
    expect(publishSpy).toHaveBeenCalledWith("OnTurnEnd", expect.any(Object));
    expect(publishSpy).toHaveBeenCalledWith("OnTurnStart", expect.any(Object));

    // Check turn switched
    expect(game.currentTurn).toBe(USERNAMES[1]);
  });
});
