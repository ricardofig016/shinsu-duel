import { DEBUG_QUERY_KINDS, resolveDebugQuery } from "../../net/debugQueries.js";
import {
  advanceToRound,
  createTestGame,
  debugAction,
  deployUnit,
  getCardIdByName,
  setupGameWithHands,
} from "../utils.js";

describe("debug queries", () => {
  test("hand lists card ids, instance ids, and names for either seat", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Novick"] });

    const alice = resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.HAND, username: "Alice" });
    expect(alice.username).toBe("Alice");
    expect(alice.cards).toHaveLength(5);
    expect(alice.cards.find((card) => card.name === "Test Scout")).toEqual({
      cardId: getCardIdByName("Test Scout"),
      instanceId: expect.any(String),
      name: "Test Scout",
    });

    const bob = resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.HAND, username: "Bob" });
    expect(bob.cards.some((card) => card.name === "Test Novick")).toBe(true);
  });

  test("deck order runs from the next card drawn to the bottom", () => {
    const game = createTestGame();
    const top = game.playerStates.Alice.deck.at(-1);

    const deck = resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.DECK, username: "Alice" });

    expect(deck.username).toBe("Alice");
    expect(deck.cards).toHaveLength(game.playerStates.Alice.deck.length);
    expect(deck.cards[0]).toEqual({ cardId: top.cardId, instanceId: top.id, name: top.name });
    // The listing is a copy: it never aliases the live deck array.
    expect(deck.cards).not.toBe(game.playerStates.Alice.deck);
  });

  test("unit abilities carry the printed indexes and the granted codes", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const scout = deployUnit(game, "Alice", "Test Scout", "scout");
    game._abilityRegistry.grant(scout.id, "Equip#1", "equipment", { type: "heal", amount: 1, raw: "heal 1" });

    const abilities = resolveDebugQuery({
      game,
      kind: DEBUG_QUERY_KINDS.UNIT_ABILITIES,
      unitId: scout.id,
    });

    expect(abilities.unitId).toBe(scout.id);
    expect(abilities.name).toBe("Test Scout");
    expect(abilities.owner).toBe("Alice");
    // Test Scout prints two abilities; the codes are what the client sends
    // back to `use-ability-action`.
    expect(abilities.native.map((entry) => entry.abilityCode)).toEqual(["0", "1"]);
    expect(abilities.native[0].ability.type).toBe("peek_hand");
    expect(abilities.granted).toHaveLength(1);
    expect(abilities.granted[0].abilityCode).toMatch(/^granted:/);
    expect(abilities.granted[0].sourceId).toBe("Equip#1");
  });

  test("state and logs read the engine's own dumps", () => {
    const game = createTestGame();
    advanceToRound(game, 2);

    const state = resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.STATE });
    expect(state).toEqual(game.toSerializedState());

    const logs = resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.LOGS });
    expect(logs.entries).toEqual(game.logger.getLogs());
    expect(logs.entries.length).toBeGreaterThan(0);
  });

  test("a query never mutates the game", () => {
    const game = createTestGame();
    const before = game.toSerializedState();
    const logLength = game.logger.getLogs().length;

    resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.HAND, username: "Bob" });
    resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.DECK, username: "Bob" });
    resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.STATE });
    resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.LOGS });

    expect(game.toSerializedState()).toEqual(before);
    expect(game.logger.getLogs()).toHaveLength(logLength);
  });

  test("rejects unknown kinds, seats, and units", () => {
    const game = createTestGame();

    expect(() => resolveDebugQuery({ game, kind: "everything" })).toThrow(
      'Unknown debug query "everything". Available: hand, deck, unit-abilities, state, logs.'
    );
    expect(() => resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.HAND, username: "Mallory" })).toThrow(
      "Player Mallory not found."
    );
    expect(() => resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.DECK, username: null })).toThrow(
      "Player null not found."
    );
    expect(() =>
      resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.UNIT_ABILITIES, unitId: "unit-missing" })
    ).toThrow("Unit unit-missing is not on the field.");
    expect(() => resolveDebugQuery({ game: null, kind: DEBUG_QUERY_KINDS.STATE })).toThrow(
      "The game has not started yet."
    );
  });

  test("a listing reflects mutations the console made", () => {
    const game = createTestGame();
    game.processAction(debugAction("debug-add-to-hand-action", { username: "Bob", cardId: getCardIdByName("Test Novick") }));

    const hand = resolveDebugQuery({ game, kind: DEBUG_QUERY_KINDS.HAND, username: "Bob" });

    expect(hand.cards.at(-1).name).toBe("Test Novick");
  });
});
