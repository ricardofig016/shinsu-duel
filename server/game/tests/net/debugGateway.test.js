import { EVENTS, buildStateView, buildDeckStatus } from "../../net/protocol.js";
import { getCardIdByName } from "../utils.js";
import { legalSlugs, makeHarness, makeStartedHarness, fullRoom, devRoom, passTurn } from "./gatewayHarness.js";

/**
 * The dev-console paths through the gateway, driven with fake sockets: room
 * gating, source and identity stamping, target validation, the broadcast a
 * mutation produces, the targeted query answers, the firehose toggle, and the
 * restart.
 */

const ROOM = "ROOM1";
const DEV_ROOM = "TESTROOM01";

const command = (type, data = {}) => ({ type, data });

/** Let the deck library's next `openCalls` lookups through, then hold the rest. */
const holdDeckLookups = (deckLibrary, openCalls) => {
  const real = deckLibrary.getOwnedDeck.bind(deckLibrary);
  let seen = 0;
  let release;
  const held = new Promise((resolve) => {
    release = resolve;
  });

  deckLibrary.getOwnedDeck = (...args) => {
    seen += 1;
    return seen <= openCalls ? real(...args) : held.then(() => real(...args));
  };
  return release;
};

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

/** Both seats of a dev room, past deck selection, mid-game. */
const devHarness = () => makeStartedHarness({ rooms: devRoom() });

/** Both seats of a normal room, past deck selection, mid-game. */
const plainHarness = () => makeStartedHarness({ rooms: fullRoom() });

describe("debug action intake", () => {
  test("a dev-room command runs as a debug action and broadcasts to both seats", async () => {
    const { registry, alice, bob } = await devHarness();
    const session = registry.get(DEV_ROOM);
    const revisionBefore = session.revision;
    const handBefore = session.game.playerStates.Alice.hand.length;

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-draw-action", { username: "Alice", amount: 2 }));

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    expect(session.game.playerStates.Alice.hand).toHaveLength(handBefore + 2);
    expect(session.revision).toBe(revisionBefore + 1);
    expect(alice.lastPayloadOf(EVENTS.GAME_UPDATE).revision).toBe(session.revision);
    expect(bob.lastPayloadOf(EVENTS.GAME_UPDATE).revision).toBe(session.revision);
  });

  test("stamps the source and the issuing player, never the payload's claim", async () => {
    const { registry, alice } = await devHarness();
    const session = registry.get(DEV_ROOM);

    await alice.trigger(
      EVENTS.GAME_DEBUG_ACTION,
      // `requestedBy` is overwritten with the connection's own username, and
      // the source is the gateway's, whatever the payload claims.
      command("debug-force-turn-action", { source: "player", requestedBy: "Bob" })
    );

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    const userActions = session.game.logger.getLogs().filter((log) => log.type === "UserAction");
    expect(userActions.at(-1).action.data.source).toBe("debug");
    expect(userActions.at(-1).action.data.requestedBy).toBe("Alice");
    expect(session.game.currentTurn).toBe("Bob");
  });

  test("a normal room refuses every debug message before touching the session", async () => {
    const { registry, alice } = await plainHarness();
    const session = registry.get(ROOM);
    const revisionBefore = session.revision;

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-draw-action", { username: "Alice", amount: 2 }));
    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "hand", requestId: "q1" });
    await alice.trigger(EVENTS.GAME_DEBUG_FIREHOSE, { enabled: false });
    await alice.trigger(EVENTS.GAME_DEBUG_RESTART);

    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(4);
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("only available in dev rooms");
    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_RESULT)).toEqual([]);
    expect(session.game.playerStates.Alice.hand).toHaveLength(5);
    expect(session.revision).toBe(revisionBefore);
    expect(session.isFirehoseEnabled).toBe(true);
    expect(registry.get(ROOM)).toBe(session);
  });

  test("validates the target seat and the payload shape", async () => {
    const { registry, alice } = await devHarness();

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-draw-action", { username: "Mallory", amount: 1 }));
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Room not found or you are not a participant.");

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, { type: "debug-draw-action" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Malformed debug action payload.");

    // A command with no seat argument reaches the engine, which refuses the
    // payload for the field its schema declares.
    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-draw-action", { amount: 1 }));
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("Missing required field: username");

    expect(registry.get(DEV_ROOM).revision).toBe(1);
  });

  test("a game that has not started and a finished game are refused", async () => {
    const harness = makeHarness({ rooms: devRoom() });
    const alice = await harness.connect({ roomCode: DEV_ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: DEV_ROOM, username: "Bob" });

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-force-turn-action"));
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Game has not started yet.");

    const aliceDeck = harness.deckLibrary.createDeck({ owner: "Alice", name: "A", cards: legalSlugs() });
    const bobDeck = harness.deckLibrary.createDeck({ owner: "Bob", name: "B", cards: legalSlugs() });
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });

    const session = harness.registry.get(DEV_ROOM);
    session.game.gameOver = { winner: "Alice", reason: "lighthouses depleted" };
    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-force-turn-action"));

    expect(alice.lastPayloadOf(EVENTS.GAME_OVER)).toEqual({ winner: "Alice", reason: "lighthouses depleted" });
  });

  test("the debug channel cannot reach a player action", async () => {
    const { registry, alice } = await devHarness();
    const session = registry.get(DEV_ROOM);

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, passTurn);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe(
      "Source debug is not allowed to perform this action."
    );
    expect(session.game.currentTurn).toBe(session.game.usernames[0]);
    expect(session.revision).toBe(1);
  });

  test("the player channel cannot reach a debug action", async () => {
    const { registry, alice } = await devHarness();
    const session = registry.get(DEV_ROOM);

    await alice.trigger(EVENTS.GAME_ACTION, command("debug-draw-action", { username: "Alice", amount: 5 }));

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe(
      "Source player is not allowed to perform this action."
    );
    expect(session.game.playerStates.Alice.hand).toHaveLength(5);
  });
});

describe("debug query intake", () => {
  test("answers the sender only, with the requested projection", async () => {
    const { registry, alice, bob } = await devHarness();
    const session = registry.get(DEV_ROOM);
    const revisionBefore = session.revision;
    const logLength = session.game.logger.getLogs().length;

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "hand", requestId: "q7", username: "Bob" });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    const result = alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT);
    expect(result.requestId).toBe("q7");
    expect(result.kind).toBe("hand");
    expect(result.data.username).toBe("Bob");
    expect(result.data.cards).toHaveLength(5);

    // Read-only, and delivered to the requester alone.
    expect(bob.payloadsOf(EVENTS.GAME_DEBUG_RESULT)).toEqual([]);
    expect(bob.payloadsOf(EVENTS.GAME_UPDATE)).toEqual([]);
    expect(session.revision).toBe(revisionBefore);
    expect(session.game.logger.getLogs()).toHaveLength(logLength);
  });

  test("defaults the seat to the sender and answers every kind", async () => {
    const { registry, alice } = await devHarness();
    const session = registry.get(DEV_ROOM);

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "hand", requestId: "q1" });
    expect(alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT).data.username).toBe("Alice");

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "deck", requestId: "q2" });
    const deck = alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT).data;
    expect(deck.cards).toHaveLength(session.game.playerStates.Alice.deck.length);

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "state", requestId: "q3" });
    expect(alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT).data.round).toBe(session.game.round);

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "logs", requestId: "q4" });
    expect(alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT).data.entries.length).toBeGreaterThan(0);
  });

  test("a unit-abilities query reaches a deployed unit", async () => {
    const { registry, alice } = await devHarness();
    const session = registry.get(DEV_ROOM);
    await alice.trigger(
      EVENTS.GAME_DEBUG_ACTION,
      command("debug-spawn-unit-action", {
        username: "Alice",
        cardId: getCardIdByName("Test Scout"),
        positionCode: "scout",
      })
    );
    const unitId = session.game.playerStates.Alice.field.frontline[0].id;

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "unit-abilities", requestId: "q9", unitId });

    const result = alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT);
    expect(result.data.unitId).toBe(unitId);
    expect(result.data.native.map((entry) => entry.abilityCode)).toEqual(["0", "1"]);
  });

  test("rejects malformed queries, unknown kinds, unknown units, and foreign seats", async () => {
    const { alice } = await devHarness();

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "hand", requestId: "" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Malformed debug query payload.");

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "hand" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Malformed debug query payload.");

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "everything", requestId: "q1" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain('Unknown debug query "everything"');

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "unit-abilities", requestId: "q2", unitId: "nope" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Unit nope is not on the field.");

    await alice.trigger(EVENTS.GAME_DEBUG_QUERY, { kind: "hand", requestId: "q3", username: "Mallory" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Room not found or you are not a participant.");
    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_RESULT)).toEqual([]);
  });
});

describe("debug firehose and restart", () => {
  test("the toggle flips the session's switch and rejects a malformed payload", async () => {
    const { registry, alice } = await devHarness();
    const session = registry.get(DEV_ROOM);
    expect(session.isFirehoseEnabled).toBe(true);

    await alice.trigger(EVENTS.GAME_DEBUG_FIREHOSE, { enabled: false });
    expect(session.isFirehoseEnabled).toBe(false);

    await alice.trigger(EVENTS.GAME_DEBUG_FIREHOSE, { enabled: "off" });
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Malformed firehose payload.");
    expect(session.isFirehoseEnabled).toBe(false);
  });

  test("restart drops the session, re-seats every connection, and returns to deck selection", async () => {
    const { registry, alice, bob } = await devHarness();
    const previous = registry.get(DEV_ROOM);

    await alice.trigger(EVENTS.GAME_DEBUG_RESTART);

    const restarted = registry.get(DEV_ROOM);
    expect(restarted).not.toBe(previous);
    expect(restarted.isStarted).toBe(false);
    expect(restarted.revision).toBe(0);
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();

    const status = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(status).toEqual(
      buildDeckStatus({
        dev: true,
        seats: [
          { username: "Alice", deckChosen: false, deckId: null, deckName: null, illegal: false },
          { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
        ],
      })
    );
    expect(bob.lastPayloadOf(EVENTS.GAME_DECK_STATUS)).toEqual(status);
    expect(restarted.connectionCount("Alice")).toBe(1);
    expect(restarted.connectionCount("Bob")).toBe(1);
  });

  test("a restart cancels the start still resolving for the session it drops", async () => {
    const harness = makeHarness({ rooms: devRoom() });
    const alice = await harness.connect({ roomCode: DEV_ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: DEV_ROOM, username: "Bob" });
    const aliceDeck = harness.deckLibrary.createDeck({ owner: "Alice", name: "A", cards: legalSlugs() });
    const bobDeck = harness.deckLibrary.createDeck({ owner: "Bob", name: "B", cards: legalSlugs() });

    // Alice's pick alone starts nothing.
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    const abandoned = harness.registry.get(DEV_ROOM);

    // Bob's pick resolves its own lookup, then holds the start's re-validation
    // of the picks open: the restart lands inside that window.
    const release = holdDeckLookups(harness.deckLibrary, 1);
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });

    await alice.trigger(EVENTS.GAME_DEBUG_RESTART);
    const restarted = harness.registry.get(DEV_ROOM);

    expect(restarted).not.toBe(abandoned);
    expect(restarted.isStarted).toBe(false);
    // The abandoned session kept none of the room's connections.
    expect(abandoned.connectionCount("Alice")).toBe(0);
    expect(abandoned.connectionCount("Bob")).toBe(0);

    release();
    await flushMicrotasks();

    expect(abandoned.isStarted).toBe(false);
    expect(harness.registry.get(DEV_ROOM)).toBe(restarted);
    expect(alice.payloadsOf(EVENTS.GAME_INIT)).toEqual([]);
    expect(bob.payloadsOf(EVENTS.GAME_INIT)).toEqual([]);

    // The restarted room starts from scratch and streams its own events.
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });

    expect(restarted.isStarted).toBe(true);
    expect(alice.lastPayloadOf(EVENTS.GAME_INIT)).not.toBeNull();
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toEqual([]);

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-force-turn-action"));
    expect(bob.payloadsOf(EVENTS.GAME_DEBUG_EVENT).length).toBeGreaterThan(0);
  });

  test("a dropped session never broadcasts stale deck-selection progress", async () => {
    const harness = makeHarness({ rooms: devRoom() });
    const alice = await harness.connect({ roomCode: DEV_ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: DEV_ROOM, username: "Bob" });
    const aliceDeck = harness.deckLibrary.createDeck({ owner: "Alice", name: "A", cards: legalSlugs() });
    const bobDeck = harness.deckLibrary.createDeck({ owner: "Bob", name: "B", cards: legalSlugs() });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    const release = holdDeckLookups(harness.deckLibrary, 1);
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });
    await alice.trigger(EVENTS.GAME_DEBUG_RESTART);
    const statusesBefore = alice.payloadsOf(EVENTS.GAME_DECK_STATUS).length;

    // Alice's pick no longer resolves, so the dropped session's start ends in
    // the "no valid pick" branch, which notifies the room it is still selecting.
    harness.deckLibrary.decks.delete(aliceDeck.id);
    release();
    await flushMicrotasks();

    expect(alice.payloadsOf(EVENTS.GAME_DECK_STATUS)).toHaveLength(statusesBefore);
  });

  test("both seats play a fresh game after a restart", async () => {
    const { registry, alice, bob, aliceDeck, bobDeck } = await devHarness();

    await alice.trigger(EVENTS.GAME_DEBUG_RESTART);
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });

    const restarted = registry.get(DEV_ROOM);
    expect(restarted.isStarted).toBe(true);
    expect(restarted.revision).toBe(1);
    expect(alice.lastPayloadOf(EVENTS.GAME_INIT)).toEqual(
      buildStateView({ game: restarted.game, revision: 1, username: "Alice" })
    );

    await alice.trigger(EVENTS.GAME_DEBUG_ACTION, command("debug-force-turn-action"));
    expect(restarted.game.currentTurn).toBe("Bob");
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
  });

  test("a normal room cannot restart its session", async () => {
    const { registry, alice } = await plainHarness();
    const session = registry.get(ROOM);

    await alice.trigger(EVENTS.GAME_DEBUG_RESTART);

    expect(registry.get(ROOM)).toBe(session);
    expect(session.isStarted).toBe(true);
  });
});
