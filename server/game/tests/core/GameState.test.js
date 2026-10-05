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
      "shinheuhSlot",
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
      expect(state.you.hand[0]).not.toHaveProperty("rarity");
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

  test("accepts a deck holding the maximum number of copies of a card", () => {
    const cardId = getCardIdByName("Test Spear Bearer");
    const copies = Array.from({ length: GameState.MAX_CARD_COPIES }, () => cardId);
    const decks = { Alice: createLegalDeck(copies), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards });

    const deckCardIds = [...game.playerStates.Alice.deck, ...game.playerStates.Alice.hand].map((c) => c.cardId);
    expect(deckCardIds.filter((id) => id === cardId)).toHaveLength(GameState.MAX_CARD_COPIES);
  });

  test("constructor throws when a deck exceeds the copy limit", () => {
    const cardId = getCardIdByName("Test Spear Bearer");
    const atLimit = createLegalDeck([cardId, cardId, cardId]);
    // Replace a filler with a fourth copy, keeping the deck at 30 cards.
    const overLimitDeck = [cardId, ...atLimit.slice(1)];
    const decks = { Alice: overLimitDeck, Bob: createLegalDeck() };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards })).toThrow(/up to 3 copies/);
  });

  test("accepts a deck holding two copies of a card", () => {
    const cardId = getCardIdByName("Test Spear Bearer");
    const decks = { Alice: createLegalDeck([cardId, cardId]), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards });

    const deckCardIds = [...game.playerStates.Alice.deck, ...game.playerStates.Alice.hand].map((c) => c.cardId);
    expect(deckCardIds.filter((id) => id === cardId)).toHaveLength(2);
  });

  test("constructor rejects an unreachable card", () => {
    const unreachableId = Number(
      Object.values(cards).find((card) => (card.deckConstraints || []).some((constraint) => constraint.type === "unreachable")).cardId
    );
    const deck = createLegalDeck();
    deck[0] = unreachableId;
    const decks = { Alice: deck, Bob: createLegalDeck() };
    expect(() => new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards })).toThrow(/unreachable/);
  });

  test("constructor rejects a test card", () => {
    const catalogWithTestCard = { ...cards, 999999: { cardId: 999999, name: "_Test Engine Card", deckConstraints: [] } };
    const deck = createLegalDeck();
    deck[0] = 999999;
    const decks = { Alice: deck, Bob: createLegalDeck() };
    expect(() =>
      new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards: catalogWithTestCard })
    ).toThrow(/test card/);
  });

  test("default decks never contain test cards", () => {
    const catalogWithTestCard = { ...cards, 999999: { cardId: 999999, name: "_Test Engine Card", deckConstraints: [] } };
    const game = new GameState(ROOM_CODE, USERNAMES, {}, null, { rng: new SeededRng(1), cards: catalogWithTestCard });

    for (const username of USERNAMES) {
      const deckCardIds = [...game.playerStates[username].deck, ...game.playerStates[username].hand].map((c) => c.cardId);
      expect(deckCardIds).toHaveLength(GameState.INIT_DECK_SIZE);
      expect(deckCardIds).not.toContain(999999);
    }
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

describe("deck-rule enforcement option", () => {
  test("is strict by default and recorded in the initial-state metadata", () => {
    const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards });
    expect(game.logger.getReplayLog().initial.meta.enforceDeckRules).toBe(true);
  });

  test("records a disabled enforcement mode in the initial-state metadata", () => {
    const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards, enforceDeckRules: false });
    expect(game.logger.getReplayLog().initial.meta.enforceDeckRules).toBe(false);
  });

  test("accepts a deck of the wrong size when enforcement is off", () => {
    const decks = { Alice: createLegalDeck().slice(0, 29), Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards, enforceDeckRules: false });
    expect(game.playerStates.Alice.deck.length + game.playerStates.Alice.hand.length).toBe(29);
  });

  test("accepts a deck exceeding the copy limit when enforcement is off", () => {
    const cardId = getCardIdByName("Test Spear Bearer");
    const overLimit = [cardId, cardId, cardId, cardId, ...createLegalDeck().slice(4)];
    const decks = { Alice: overLimit, Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards, enforceDeckRules: false });

    const dealt = [...game.playerStates.Alice.deck, ...game.playerStates.Alice.hand].map((c) => c.cardId);
    expect(dealt.filter((id) => id === cardId)).toHaveLength(4);
  });

  test("accepts an unreachable card when enforcement is off", () => {
    const unreachableId = Number(
      Object.values(cards).find((card) => (card.deckConstraints || []).some((constraint) => constraint.type === "unreachable")).cardId
    );
    const deck = createLegalDeck();
    deck[0] = unreachableId;
    const decks = { Alice: deck, Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards, enforceDeckRules: false });

    const dealt = [...game.playerStates.Alice.deck, ...game.playerStates.Alice.hand].map((c) => c.cardId);
    expect(dealt).toContain(unreachableId);
  });

  test("accepts a test card when enforcement is off", () => {
    const catalogWithTestCard = { ...cards, 999999: { cardId: 999999, name: "_Test Engine Card", deckConstraints: [] } };
    const deck = createLegalDeck();
    deck[0] = 999999;
    const decks = { Alice: deck, Bob: createLegalDeck() };
    const game = new GameState(ROOM_CODE, USERNAMES, decks, null, {
      rng: new SeededRng(1),
      cards: catalogWithTestCard,
      enforceDeckRules: false,
    });

    const dealt = [...game.playerStates.Alice.deck, ...game.playerStates.Alice.hand].map((c) => c.cardId);
    expect(dealt).toContain(999999);
  });

  test("still rejects an unknown card id when enforcement is off (buildable contract)", () => {
    const badDeck = Array.from({ length: 30 }, () => 999999);
    const decks = { Alice: badDeck, Bob: createLegalDeck() };
    expect(() =>
      new GameState(ROOM_CODE, USERNAMES, decks, null, { rng: new SeededRng(1), cards, enforceDeckRules: false })
    ).toThrow(/does not exist/);
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
    expect(ownView.conditions[0]).toMatchObject({
      key: "poisoned",
      numeric: true,
      name: "Poisoned",
      description: {
        segments: [
          "I take ",
          { type: "value", ref: "condition", text: "x" },
          " damage when I use an ",
          { type: "rule", ref: "ability", text: "Ability" },
        ],
      },
      iconPath: "/assets/icons/conditions/poisoned.png",
    });

    const opponentView = game.getClientState("Bob").opponent.field.frontline.find((u) => u.id === unit.id);
    expect(toMagnitudes(opponentView.conditions)).toEqual(expected);
  });

  test("conditions missing from the catalog degrade to their raw key", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "condition",
      key: "no-such-condition",
      value: 1,
      operation: "add",
    });

    const ownView = game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id);
    expect(ownView.conditions).toEqual([
      { key: "no-such-condition", magnitude: 1, numeric: false, name: "no-such-condition", description: null, iconPath: null },
    ]);
  });

  test("unit traits carry their effective value, the numeric flag, and the slot their copy fills", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    const traits = () =>
      game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id).traits;

    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "trait",
      key: "strong",
      value: 2,
      operation: "add",
    });
    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "trait",
      key: "barrier",
      value: 1,
      operation: "add",
    });

    expect(traits().find((trait) => trait.key === "strong")).toMatchObject({
      value: 2,
      numeric: true,
      name: "Strong",
      iconPath: "/assets/icons/traits/strong.png",
      description: {
        segments: ["I deal +", { type: "value", ref: "trait", text: "x" }, " damage"],
      },
    });
    // A valueless trait still carries the value the engine wired, but its
    // catalog entry is not numeric, so no number is ever shown for it.
    expect(traits().find((trait) => trait.key === "barrier")).toMatchObject({
      value: 1,
      numeric: false,
      name: "Barrier",
    });
  });

  test("the trait projection states what the unit has now, not what the card printed", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    const traitKeys = () =>
      game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id).traits.map((trait) => trait.key);

    // A trait granted at runtime joins the projection: the strip is a board
    // readout, not a copy of the card face.
    game.modifierStack.apply({
      sourceId: "Equip#9",
      sourceType: "equipment",
      targetId: unit.id,
      type: "trait",
      key: "strong",
      value: 2,
    });
    expect(traitKeys()).toContain("strong");

    // Silence removes trait modifiers, so the trait leaves the projection with
    // them and the strip stops claiming a trait the unit no longer has.
    game.modifierStack.removeWhere((m) => m.targetId === unit.id && m.type === "trait" && m.key === "strong");
    expect(traitKeys()).not.toContain("strong");
  });

  test("unit keywords and runtime affiliations and attributes reach both seats' views", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");

    game.modifierStack.apply({
      sourceId: "Equip#free", sourceType: "equipment", targetId: unit.id,
      type: "keyword", key: "free", value: 1, meta: { first: false },
    });
    game.modifierStack.apply({
      sourceId: "Passive#aff", sourceType: "passive", targetId: unit.id,
      type: "affiliation", key: "wolhaiksong", value: 1,
    });
    game.modifierStack.apply({
      sourceId: "Passive#attr", sourceType: "passive", targetId: unit.id,
      type: "attribute", key: "anima", value: 1,
    });

    const ownView = () =>
      game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id);
    const opponentView = () =>
      game.getClientState("Bob").opponent.field.frontline.find((u) => u.id === unit.id);

    for (const view of [ownView, opponentView]) {
      expect([...view().keywords].sort()).toEqual(["free"]);
      expect(view().runtimeAffiliations).toEqual([
        { key: "wolhaiksong", name: "Wolhaiksong", type: "organization", iconPath: "/assets/icons/affiliations/wolhaiksong.png" },
      ]);
      expect(view().runtimeAttributes).toEqual([
        expect.objectContaining({
          key: "anima",
          name: "Anima",
          iconPath: "/assets/icons/attributes/anima.png",
          description: expect.objectContaining({ segments: expect.any(Array) }),
        }),
      ]);
    }

    // The seat's own view resolves granted abilities; the opponent's does not.
    expect(ownView()).toHaveProperty("grantedAbilities");
    expect(opponentView()).not.toHaveProperty("grantedAbilities");

    // Removing the granting sources takes the derived state with them.
    game.modifierStack.removeBySource("Equip#free");
    game.modifierStack.removeBySource("Passive#aff");
    game.modifierStack.removeBySource("Passive#attr");

    for (const view of [ownView, opponentView]) {
      expect(view().keywords).toEqual([]);
      expect(view().runtimeAffiliations).toEqual([]);
      expect(view().runtimeAttributes).toEqual([]);
    }
  });

  test("runtime codes the unit's card already prints are not repeated, and duplicates squash", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    // Test Scout prints `team-chang`; the stack now carries the same code.
    game.modifierStack.apply({
      sourceId: "Passive#dup-one", sourceType: "passive", targetId: unit.id,
      type: "affiliation", key: "team-chang", value: 1,
    });
    // Two distinct sources grant the same unprinted code: one entry, not two.
    for (const sourceId of ["Passive#dup-two", "Passive#dup-three"]) {
      game.modifierStack.apply({
        sourceId, sourceType: "passive", targetId: unit.id,
        type: "attribute", key: "anima", value: 1,
      });
    }

    const view = game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id);
    expect(view.runtimeAffiliations).toEqual([]);
    expect(view.runtimeAttributes).toHaveLength(1);
    expect(view.runtimeAttributes[0].key).toBe("anima");
  });

  test("a first-scoped keyword grant is reported until the unit's first ability of the round", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    game.modifierStack.apply({
      sourceId: "Passive#first", sourceType: "passive", targetId: unit.id,
      type: "keyword", key: "free", value: 1, meta: { first: true },
    });

    const keywords = () => game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id).keywords;
    expect(keywords()).toEqual(["free"]);
    expect(game.hasUsedAbilityThisRound(unit.id)).toBe(false);
    expect(game.effectiveKeywords(unit.id).has("free")).toBe(true);

    game.markAbilityUsed(unit.id);
    expect(keywords()).toEqual([]);
    expect(game.hasUsedAbilityThisRound(unit.id)).toBe(true);
    expect(game.effectiveKeywords(unit.id).has("free")).toBe(false);
    expect(game.effectiveKeywords("Unit#does-not-exist").size).toBe(0);

    game.modifierStack.removeBySource("Passive#first");
    expect(game.effectiveKeywords(unit.id).has("free")).toBe(false);
  });

  test("the seat's own cards carry the engine-resolved cost in hand and on the field", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout", "Test Scout"] });
    const handCard = () => game.getClientState("Alice").you.hand[0];
    expect(handCard().effectiveCost).toBe(1);

    // A board cost modifier on the owner is what the engine charges and what
    // the seat now reads, in both places a card appears.
    game.modifierStack.apply({
      sourceId: "Passive#cost", sourceType: "passive", targetId: "Alice",
      type: "stat", key: "cost", value: -1,
    });
    expect(handCard().effectiveCost).toBe(0);
    expect(handCard().cost).toBe(1);

    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    const fieldUnit = () => game.getClientState("Alice").you.field.frontline.find((u) => u.id === unit.id);
    expect(fieldUnit().card.effectiveCost).toBe(0);
    expect(fieldUnit().card.cost).toBe(1);

    // Without the modifier both addresses report the printed cost.
    game.modifierStack.removeBySource("Passive#cost");
    expect(handCard().effectiveCost).toBe(1);
    expect(fieldUnit().card.effectiveCost).toBe(1);
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

  // RULES.md §Combat Slots: the Shinheuh slot exists only while an Anima
  // created it. Its `{ available, used }` pair carries that on its own:
  // `{ false, false }` is no slot, `{ true, false }` is a slot that exists and
  // is unspent, `{ false, true }` is a slot that exists and was spent this
  // round. Both seats must read the same distinction.
  test("both seats read the Shinheuh slot's no-slot, unspent, and spent states", () => {
    const game = setupGameWithHands({});

    // No Anima has created the slot yet.
    expect(game.getClientState("Alice").you.shinheuhSlot).toEqual({ available: false, used: false });
    expect(game.getClientState("Bob").opponent.shinheuhSlot).toEqual({ available: false, used: false });

    CombatSlotService.grantShinheuhSlot(game.playerStates.Alice, game.eventBus, "Alice");
    expect(game.getClientState("Alice").you.shinheuhSlot).toEqual({ available: true, used: false });
    expect(game.getClientState("Bob").opponent.shinheuhSlot).toEqual({ available: true, used: false });
    // Alice holding the slot says nothing about Bob's own slot.
    expect(game.getClientState("Alice").opponent.shinheuhSlot).toEqual({ available: false, used: false });
    expect(game.getClientState("Bob").you.shinheuhSlot).toEqual({ available: false, used: false });

    expect(CombatSlotService.consumeShinheuhSlot(game.playerStates.Alice)).toBe(true);
    expect(game.getClientState("Alice").you.shinheuhSlot).toEqual({ available: false, used: true });
    expect(game.getClientState("Bob").opponent.shinheuhSlot).toEqual({ available: false, used: true });
  });

  test("a revoked Shinheuh slot reads as no slot in both seats", () => {
    const game = setupGameWithHands({});
    CombatSlotService.grantShinheuhSlot(game.playerStates.Bob, game.eventBus, "Bob");
    expect(game.getClientState("Alice").opponent.shinheuhSlot).toEqual({ available: true, used: false });

    // AnimaEngine revokes at round start when no Anima unit is on the field.
    CombatSlotService.revokeShinheuhSlot(game.playerStates.Bob);
    expect(game.getClientState("Bob").you.shinheuhSlot).toEqual({ available: false, used: false });
    expect(game.getClientState("Alice").opponent.shinheuhSlot).toEqual({ available: false, used: false });
  });

  test("the projected Shinheuh slot is a copy, not the authoritative slot", () => {
    const game = setupGameWithHands({});
    CombatSlotService.grantShinheuhSlot(game.playerStates.Alice, game.eventBus, "Alice");

    const opponentView = game.getClientState("Bob").opponent.shinheuhSlot;
    opponentView.available = false;
    opponentView.used = true;

    expect(game.playerStates.Alice.shinheuhSlot).toEqual({ available: true, used: false });
    expect(CombatSlotService.isShinheuhSlotAvailable(game.playerStates.Alice)).toBe(true);
  });
});

describe("skills-played game counter", () => {
  let game;

  beforeEach(() => {
    game = new GameState(ROOM_CODE, USERNAMES, {}, null, { rng: new SeededRng(1), cards });
  });

  test("counts recorded skills per player", () => {
    game.recordSkillPlayed("Alice");
    game.recordSkillPlayed("Alice");
    game.recordSkillPlayed("Bob");

    expect(game.getSkillsPlayedThisGame("Alice")).toBe(2);
    expect(game.getSkillsPlayedThisGame("Bob")).toBe(1);
  });

  test("reads as 0 for a player who has not played a skill and is never cleared", () => {
    expect(game.getSkillsPlayedThisGame("Alice")).toBe(0);

    game.recordSkillPlayed("Alice");
    game.recordCardPlayed("Alice");

    expect(game.getSkillsPlayedThisGame("Alice")).toBe(1);
  });
});
