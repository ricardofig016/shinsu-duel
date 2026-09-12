import { EVENTS } from "../../net/protocol.js";
import { createNetHarness } from "./harness.js";

/**
 * The dev console over the real transport: a TESTROOM room streams engine
 * events to both seats from the moment its game starts, a normal room streams
 * nothing, the toggle stops delivery, and a restart returns both seats to the
 * deck-selection phase for a fresh game.
 *
 * The console's own connection is modelled the way the browser opens it: an
 * extra socket on a seat that already has one.
 */

const DEV_ROOM = "TESTROOM01";
const ROOM_RECORD = (seed) => ({ players: [], opponent: "friend", difficulty: null, seed });

describe("dev console over the real transport", () => {
  let harness;

  beforeEach(() => {
    harness = null;
  });

  afterEach(async () => {
    if (harness) await harness.close();
  });

  const startRoom = async (roomCode) => {
    harness.rooms[roomCode] = ROOM_RECORD(1);
    harness.joinRoom(roomCode, "Alice");
    harness.joinRoom(roomCode, "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode });
    await harness.selectDecks({ alice, bob });
    return { alice, bob };
  };

  const passFrom = (roomCode, client) => {
    client.emit(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: {} });
  };

  test("a TESTROOM game streams its engine events to both seats", async () => {
    harness = await createNetHarness();
    const { alice, bob } = await startRoom(DEV_ROOM);
    // The console's own socket: a second connection on a seat that already has
    // one, exactly like the page's debug module.
    const consoleSocket = await harness.connectPlayer({ username: "Alice", roomCode: DEV_ROOM });

    passFrom(DEV_ROOM, consoleSocket);

    await harness.waitFor(
      () => consoleSocket.payloadsOf(EVENTS.GAME_DEBUG_EVENT).length > 0,
      "the dev room never streamed an engine event."
    );
    const lines = consoleSocket.payloadsOf(EVENTS.GAME_DEBUG_EVENT);
    expect(lines.map((line) => line.name)).toEqual(["turn:ended", "turn:started"]);
    expect(lines[0].sequence).toBe(1);
    expect(lines[0].fields.username).toBe("Alice");
    // Both seats see the stream, and the page's own connection is untouched.
    expect(bob.payloadsOf(EVENTS.GAME_DEBUG_EVENT)).toEqual(lines);
    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_EVENT)).toEqual(lines);
  });

  test("a normal room never streams, and the console is refused there", async () => {
    harness = await createNetHarness();
    const roomCode = harness.createRoom();
    const { alice } = await startRoom(roomCode);

    passFrom(roomCode, alice);
    await alice.next(EVENTS.GAME_UPDATE);

    alice.emit(EVENTS.GAME_DEBUG_ACTION, {
      type: "debug-force-turn-action",
      data: {},
    });
    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_ERROR).length > 0,
      "the normal room never refused the debug command."
    );

    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_EVENT)).toEqual([]);
    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_RESULT)).toEqual([]);
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("only available in dev rooms");
  });

  test("the firehose toggle stops and resumes delivery", async () => {
    harness = await createNetHarness();
    const { alice, bob } = await startRoom(DEV_ROOM);

    passFrom(DEV_ROOM, alice);
    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_DEBUG_EVENT).length > 0,
      "the dev room never streamed an engine event."
    );
    const streamed = alice.payloadsOf(EVENTS.GAME_DEBUG_EVENT).length;
    expect(bob.payloadsOf(EVENTS.GAME_DEBUG_EVENT)).toHaveLength(streamed);

    alice.emit(EVENTS.GAME_DEBUG_FIREHOSE, { enabled: false });
    await harness.waitFor(
      () => harness.registry.get(DEV_ROOM).isFirehoseEnabled === false,
      "the firehose toggle never reached the session."
    );
    passFrom(DEV_ROOM, bob);
    await bob.next(EVENTS.GAME_UPDATE);
    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_EVENT)).toHaveLength(streamed);

    alice.emit(EVENTS.GAME_DEBUG_FIREHOSE, { enabled: true });
    await harness.waitFor(
      () => harness.registry.get(DEV_ROOM).isFirehoseEnabled === true,
      "the firehose never resumed."
    );
    passFrom(DEV_ROOM, alice);
    await alice.next(EVENTS.GAME_UPDATE);
    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_DEBUG_EVENT).length > streamed,
      "the resumed firehose delivered nothing."
    );
  });

  test("queries answer the sender and never bump the revision", async () => {
    harness = await createNetHarness();
    const { alice, bob } = await startRoom(DEV_ROOM);
    const session = harness.registry.get(DEV_ROOM);
    const revisionBefore = session.revision;

    const consoleSocket = await harness.connectPlayer({ username: "Alice", roomCode: DEV_ROOM });
    consoleSocket.emit(EVENTS.GAME_DEBUG_QUERY, { kind: "hand", requestId: "q1", username: "Bob" });

    const result = await consoleSocket.next(EVENTS.GAME_DEBUG_RESULT);
    expect(result.requestId).toBe("q1");
    expect(result.data.username).toBe("Bob");
    expect(result.data.cards).toHaveLength(5);
    expect(session.revision).toBe(revisionBefore);
    expect(bob.payloadsOf(EVENTS.GAME_DEBUG_RESULT)).toEqual([]);
    expect(alice.payloadsOf(EVENTS.GAME_DEBUG_RESULT)).toEqual([]);
  });

  test("a restart returns both seats to deck selection and starts a fresh game", async () => {
    harness = await createNetHarness();
    const { alice, bob } = await startRoom(DEV_ROOM);
    const previous = harness.registry.get(DEV_ROOM);
    const initsBefore = alice.payloadsOf(EVENTS.GAME_INIT).length;
    // Deck-selection progress also arrives while the first game is starting,
    // so the restart is observed through counts, not through presence.
    const statusesBefore = alice.payloadsOf(EVENTS.GAME_DECK_STATUS).length;
    const bobStatusesBefore = bob.payloadsOf(EVENTS.GAME_DECK_STATUS).length;

    alice.emit(EVENTS.GAME_DEBUG_RESTART);

    await harness.waitFor(
      () => harness.registry.get(DEV_ROOM) !== previous,
      "the restart never replaced the session."
    );
    await harness.waitFor(
      () =>
        alice.payloadsOf(EVENTS.GAME_DECK_STATUS).length > statusesBefore &&
        bob.payloadsOf(EVENTS.GAME_DECK_STATUS).length > bobStatusesBefore,
      "the restart never returned the seats to deck selection."
    );
    const restarted = harness.registry.get(DEV_ROOM);
    expect(restarted.isStarted).toBe(false);
    expect(alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS).seats).toEqual([
      { username: "Alice", deckChosen: false, deckId: null, deckName: null, illegal: false },
      { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
    ]);

    await harness.selectDecks({ alice, bob });

    await harness.waitFor(
      () => alice.payloadsOf(EVENTS.GAME_INIT).length > initsBefore && bob.payloadsOf(EVENTS.GAME_INIT).length > initsBefore,
      "the restarted game never started."
    );
    expect(restarted.isStarted).toBe(true);
    expect(restarted.revision).toBe(1);

    // The restarted game's own subscriptions are attached: it streams too.
    passFrom(DEV_ROOM, alice);
    await harness.waitFor(
      () => bob.payloadsOf(EVENTS.GAME_DEBUG_EVENT).some((line) => line.name === "turn:ended"),
      "the restarted game never streamed an engine event."
    );
  });
});
