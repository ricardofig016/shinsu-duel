import GameState from "../../GameState.js";
import CombatSlotService from "../../services/CombatSlotService.js";
import SeededRng from "../../utils/SeededRng.js";
import { advanceToRound, createLegalDeck, deployUnit, expectShinsuState, getCardIdByName, setupGameWithHands, cards } from "../utils.js";

const ROOM_CODE = "TEST";
const USERNAMES = ["Alice", "Bob"];

// TODO: add round 30+ (decks exhausted)
describe.each([1, 3, 10, 25])("core rules at round %i", (round) => {
  let game, firstPlayer, secondPlayer;

  beforeEach(() => {
    game = new GameState(ROOM_CODE, USERNAMES, {}, null, { rng: new SeededRng(1), cards });
    firstPlayer = game.currentTurn;
    secondPlayer = firstPlayer === "Alice" ? "Bob" : "Alice";
    advanceToRound(game, round);
  });

  test(`game.round should be ${round}`, () => {
    expect(game.round).toBe(round);
  });

  test("round increments after both players pass their turn", () => {
    // Alice -> Bob
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: firstPlayer } });
    // Bob -> round should increment
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: secondPlayer } });
    expect(game.round).toBe(round + 1);
  });

  test("turn alternates between players", () => {
    expect(game.currentTurn).toBe(firstPlayer);
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: firstPlayer } });
    expect(game.currentTurn).toBe(secondPlayer);
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: secondPlayer } });
    expect(game.currentTurn).toBe(firstPlayer);
  });

  test("amount of shinsu", () => {
    const aliceState = game.getClientState("Alice").you;
    const bobState = game.getClientState("Bob").you;
    const sumOfAllUnspentShinsu = ((game.round - 1) * (game.round - 1 + 1)) / 2;
    const expectedRecharged = Math.min(sumOfAllUnspentShinsu, GameState.MAX_RECHARGED_SHINSU);
    const expectedNormalAvailable = Math.min(game.round, GameState.MAX_NORMAL_SHINSU);
    expectShinsuState(aliceState, 0, expectedNormalAvailable, expectedRecharged);
    expectShinsuState(bobState, 0, expectedNormalAvailable, expectedRecharged);
  });

  test("number of cards in hand", () => {
    const aliceState = game.getClientState("Alice").you;
    const bobState = game.getClientState("Bob").you;
    const expectedHandSize = GameState.INIT_HAND_SIZE + (game.round - 1);
    expect(aliceState.hand.length).toBe(expectedHandSize);
    expect(bobState.hand.length).toBe(expectedHandSize);
  });

  test("number of cards in deck", () => {
    const aliceState = game.getClientState("Alice").you;
    const bobState = game.getClientState("Bob").you;
    const expectedDeckSize = GameState.INIT_DECK_SIZE - (GameState.INIT_HAND_SIZE + (game.round - 1));
    expect(aliceState.deckSize).toBe(expectedDeckSize);
    expect(bobState.deckSize).toBe(expectedDeckSize);
  });

  test("getOpponentUsername returns correct opponent", () => {
    expect(game.getClientState(firstPlayer).opponent.username).toBe(secondPlayer);
    expect(game.getClientState(secondPlayer).opponent.username).toBe(firstPlayer);
  });

  test("opponent view exposes combat slot availability", () => {
    const opponentUsername = game.getClientState(firstPlayer).opponent.username;
    CombatSlotService.consume(game.playerStates[opponentUsername], "fisherman");

    const view = game.getClientState(firstPlayer);
    expect(view.opponent.combatSlots).toEqual(game.playerStates[opponentUsername].combatSlots);
    expect(view.opponent.combatSlots.fisherman).toEqual({ available: false });
  });

  test("getClientState returns correct structure", () => {
    const state = game.getClientState(firstPlayer);

    // Top-level keys
    expect(state).toHaveProperty("round");
    expect(state).toHaveProperty("currentTurn");
    expect(state).toHaveProperty("gameOver");
    expect(state).toHaveProperty("you");
    expect(state).toHaveProperty("opponent");
    expect(state.round).toBe(round);
    expect(state.gameOver).toBeNull();

    // 'you' and 'opponent' should have expected keys
    [
      "combatSlotCodes",
      "combatSlots",
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
      [
        "id",
        "cardId",
        "type",
        "name",
        "sobriquet",
        "rarity",
        "maxHp",
        "cost",
        "visible",
        "affiliations",
        "positions",
        "traits",
        "abilities",
        "passiveAbilities",
        "owner",
      ].forEach((key) => {
        expect(state.you.hand[0]).toHaveProperty(key);
      });
      expect(state.you.hand[0]).toHaveProperty("id");
      expect(state.you.hand[0]).toHaveProperty("traits");
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
    expect(() => game.processAction({ type: "invalid-action", data: { source: "player" } })).toThrow(
      /invalid action type/
    );
  });

  test("invalid username throws error", () => {
    expect(() =>
      game.processAction({ type: "pass-turn-action", data: { source: "player", username: "NotAPlayer" } })
    ).toThrow(/Player NotAPlayer not found/);
  });

  test("missing fields in action data throws error", () => {
    expect(() =>
      game.processAction({ type: "deploy-unit-action", data: { source: "player", username: firstPlayer } })
    ).toThrow(/Missing required field/);
  });

  test("not your turn throws error", () => {
    expect(() =>
      game.processAction({ type: "pass-turn-action", data: { source: "player", username: secondPlayer } })
    ).toThrow(/not your turn/);
  });
});

describe("deck behavior", () => {
  test("constructor accepts custom decks and draws initial hand from deck (pop semantics)", () => {
    const cardNames = ["Test Spear Bearer", "Test Light Bearer", "Test Light Bearer Only", "Test Expensive Unit"];
    const aliceDeck = createLegalDeck(cardNames.map((name) => getCardIdByName(name)));
    const bobDeck = createLegalDeck();

    const decks = { Alice: aliceDeck, Bob: bobDeck };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards });

    // After constructor, initial hand size GameState INIT_HAND_SIZE
    const aliceClient = game.getClientState("Alice").you;
    expect(aliceClient.hand.length).toBe(GameState.INIT_HAND_SIZE);

    // Because draw uses pop(), Alice's hand contains the requested cards in reverse order.
    const aliceHandNames = aliceClient.hand.map((c) => c.name);
    expect(aliceHandNames.slice(0, 4)).toEqual([...cardNames].reverse());

    // Deck size decreased GameState INIT_HAND_SIZE
    expect(aliceClient.deckSize).toBe(GameState.INIT_DECK_SIZE - GameState.INIT_HAND_SIZE);

    // Bob also should have a reduced deck and 4 cards in hand
    const bobClient = game.getClientState("Bob").you;
    expect(bobClient.hand.length).toBe(GameState.INIT_HAND_SIZE);
    expect(bobClient.deckSize).toBe(GameState.INIT_DECK_SIZE - GameState.INIT_HAND_SIZE);
  });

  test("getClientState.deckSize matches internal deck length", () => {
    const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards });

    const aliceClient = game.getClientState("Alice").you;
    expect(aliceClient.deckSize).toBe(game.playerStates.Alice.deck.length);
  });

  test("constructor throws for invalid deck length (too short)", () => {
    // Alice deck has wrong length
    const badAliceDeck = Array.from({ length: 29 }, () => 0);
    const decks = { Alice: badAliceDeck, Bob: Array(30).fill(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1) })).toThrow(/deck must be an array of/);
  });

  test("constructor throws for invalid deck length (too long)", () => {
    // Alice deck has wrong length
    const badAliceDeck = Array.from({ length: 31 }, () => 0);
    const decks = { Alice: badAliceDeck, Bob: Array(30).fill(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1) })).toThrow(/deck must be an array of/);
  });

  test("constructor throws for invalid card id", () => {
    // Use a clearly invalid card id (very large)
    const invalidCardId = 999999;
    const badDeck = Array.from({ length: 30 }, () => invalidCardId);
    const decks = { Alice: badDeck, Bob: Array(30).fill(0) };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1) })).toThrow(/does not exist/);
  });

  test("drawing when deck is empty does not crash and does not increase hand", () => {
    const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards });

    // Simulate Alice's deck becoming empty
    game.playerStates.Alice.deck = [];
    const handBefore = game.getClientState("Alice").you.hand;

    // Force an end-of-round draw by making both players pass
    // Determine current players for safe calls
    const first = game.currentTurn;
    const second = first === "Alice" ? "Bob" : "Alice";
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: first } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: second } });

    const handAfter = game.getClientState("Alice").you.hand;
    expect(handAfter).toEqual(handBefore); // no new cards since deck was empty
  });
});

describe("startedWithCard", () => {
  test("reflects the immutable starting deck composition per player", () => {
    const rachelId = getCardIdByName("Test Light Bearer");
    const baangId = getCardIdByName("Test Damage Skill");
    const game = new GameState(ROOM_CODE, USERNAMES, {
      Alice: createLegalDeck([rachelId]),
      Bob: createLegalDeck([baangId]),
    }, null, { rng: new SeededRng(1), cards });

    expect(game.startedWithCard("Alice", "Test Light Bearer")).toBe(true);
    expect(game.startedWithCard("Bob", "Test Light Bearer")).toBe(false);
    expect(game.startedWithCard("Bob", "Test Damage Skill")).toBe(true);
    // Case-insensitive and unaffected by draws/plays.
    expect(game.startedWithCard("Alice", "test light bearer")).toBe(true);
  });
});

describe("client state projections", () => {
  test("unit conditions carry their effective magnitude in own and opponent views", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "condition",
      key: "poisoned",
      value: 1,
      operation: "add",
    });
    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "condition",
      key: "poisoned",
      value: 2,
      operation: "add",
    });
    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "condition",
      key: "stunned",
      value: 1,
      operation: "add",
    });

    const toMagnitudes = (conditions) =>
      Object.fromEntries(conditions.map((condition) => [condition.key, condition.magnitude]));
    const expected = { poisoned: 3, stunned: 1 };

    const ownView = game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id);
    expect(toMagnitudes(ownView.conditions)).toEqual(expected);
    expect(ownView.conditions[0]).toHaveProperty("key");
    expect(ownView.conditions[0]).toHaveProperty("magnitude");

    const opponentView = game.getClientState("Bob").opponent.field.frontline.find((u) => u.id === unit.id);
    expect(toMagnitudes(opponentView.conditions)).toEqual(expected);
  });

  test("gameOver is projected as a copy once the game has ended", () => {
    const game = new GameState(ROOM_CODE, USERNAMES, {}, null, { rng: new SeededRng(1), cards });
    expect(game.getClientState("Alice").gameOver).toBeNull();

    game.playerStates.Alice.deck = [];
    const first = game.currentTurn;
    const second = first === "Alice" ? "Bob" : "Alice";
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: first } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: second } });

    const gameOver = game.getClientState("Alice").gameOver;
    expect(gameOver).toEqual({ winner: "Bob", reason: "deck exhausted" });

    // Mutating the projection must not corrupt the authoritative result.
    gameOver.winner = "tampered";
    expect(game.gameOver.winner).toBe("Bob");
  });
});
