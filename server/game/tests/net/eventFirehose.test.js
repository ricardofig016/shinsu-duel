import EventFirehose from "../../net/eventFirehose.js";
import GameSession from "../../net/GameSession.js";
import { EVENTS } from "../../net/protocol.js";
import EVT from "../../EventCatalog.js";
import { createTestGame } from "../utils.js";

/**
 * The firehose is a net-layer diagnostic: it only reads engine events and
 * hands compact lines to a session, so it is driven here through a real
 * `GameSession` whose game is a fixture-catalog game.
 */

/**
 * The root events a game emits while it is constructed, before any streamer can
 * attach to its bus. The stream opens with them.
 */
const OPENING_EVENTS = [EVT.GAME_STARTED, EVT.ROUND_START, EVT.TURN_START];

const makeSession = ({ roomCode = "TESTROOM01" } = {}) => {
  const session = new GameSession({
    roomCode,
    usernames: ["Alice", "Bob"],
    seed: 1,
    createGame: () => createTestGame(),
  });
  const received = { Alice: [], Bob: [] };
  for (const username of ["Alice", "Bob"]) {
    session.attach(username, {
      send: (event, payload) => received[username].push({ event, payload }),
    });
  }
  session.ensureGame();
  return { session, received, game: session.game };
};

const linesOf = (received, username) =>
  received[username].filter((entry) => entry.event === EVENTS.GAME_DEBUG_EVENT).map((entry) => entry.payload);

describe("EventFirehose", () => {
  test("streams one compact line per root event to both seats", () => {
    const { session, received, game } = makeSession();
    const unsubscribe = new EventFirehose({ session }).subscribe();

    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });

    const alice = linesOf(received, "Alice");
    const bob = linesOf(received, "Bob");
    expect(alice.length).toBeGreaterThan(0);
    expect(alice).toEqual(bob);
    // The stream opens with the events the game emitted while it was being
    // built, then follows the action it just resolved.
    expect(alice.map((line) => line.name)).toEqual([...OPENING_EVENTS, EVT.TURN_END, EVT.TURN_START]);
    expect(alice.map((line) => line.sequence)).toEqual([1, 2, 3, 4, 5]);
    expect(alice.at(-2).fields.username).toBe("Alice");

    unsubscribe();
  });

  test("nested events stay on their root line", () => {
    const { session, received, game } = makeSession();
    const unsubscribe = new EventFirehose({ session }).subscribe();
    game.eventBus.on(
      "test:root",
      (payload, context) => context.emitChild("test:child", { from: "root" }),
      { phase: "execute" }
    );

    game.eventBus.emit("test:root", { username: "Bob" });

    const lines = linesOf(received, "Alice");
    expect(lines.map((line) => line.name)).toEqual([...OPENING_EVENTS, "test:root"]);
    expect(lines.at(-1).fields).toEqual({ username: "Bob" });

    unsubscribe();
  });

  test("the toggle stops delivery and resumes on demand", () => {
    const { session, received, game } = makeSession();
    const unsubscribe = new EventFirehose({ session }).subscribe();

    game.eventBus.emit("test:first", {});
    session.setFirehoseEnabled(false);
    game.eventBus.emit("test:silent", {});
    session.setFirehoseEnabled(true);
    game.eventBus.emit("test:again", {});

    const expected = [...OPENING_EVENTS, "test:first", "test:again"];
    expect(linesOf(received, "Alice").map((line) => line.name)).toEqual(expected);
    // Sequence numbers count streamed lines only.
    expect(linesOf(received, "Alice").map((line) => line.sequence)).toEqual(
      expected.map((_, index) => index + 1)
    );

    unsubscribe();
  });

  test("unsubscribing stops the stream", () => {
    const { session, received, game } = makeSession();
    const unsubscribe = new EventFirehose({ session }).subscribe();

    game.eventBus.emit("test:before", {});
    unsubscribe();
    game.eventBus.emit("test:after", {});

    expect(linesOf(received, "Alice").map((line) => line.name)).toEqual([
      ...OPENING_EVENTS,
      "test:before",
    ]);
  });

  test("a connection joining a running game catches up with the whole stream", () => {
    const { session, received, game } = makeSession();
    const streamer = new EventFirehose({ session });
    const unsubscribe = streamer.subscribe();
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });

    // The console's own socket: a connection that attaches after the game and
    // one action have already happened.
    const caughtUp = [];
    streamer.catchUp({ send: (event, payload) => caughtUp.push({ event, payload }) });

    const lines = caughtUp
      .filter((entry) => entry.event === EVENTS.GAME_DEBUG_EVENT)
      .map((entry) => entry.payload);
    expect(lines).toEqual(linesOf(received, "Alice"));
    expect(lines.map((line) => line.name)).toEqual([...OPENING_EVENTS, EVT.TURN_END, EVT.TURN_START]);
    expect(lines.map((line) => line.sequence)).toEqual([1, 2, 3, 4, 5]);

    // A silenced stream catches a connection up with nothing, and the live
    // lines keep numbering where the stream left off.
    session.setFirehoseEnabled(false);
    const silent = [];
    streamer.catchUp({ send: (event, payload) => silent.push(payload) });
    expect(silent).toEqual([]);

    session.setFirehoseEnabled(true);
    game.eventBus.emit("test:later", {});
    const after = [];
    streamer.catchUp({ send: (event, payload) => after.push(payload) });
    expect(after.map((line) => line.name)).toEqual([
      ...OPENING_EVENTS,
      EVT.TURN_END,
      EVT.TURN_START,
      "test:later",
    ]);
    expect(after.at(-1).sequence).toBe(6);

    unsubscribe();
  });

  test("a subscriber never consumes a game clock tick", () => {
    const { session, game } = makeSession();
    const before = game.toSerializedState().clock;

    new EventFirehose({ session }).subscribe();

    expect(game.toSerializedState().clock).toBe(before);
  });

  test("needs a started game and a session that can broadcast", () => {
    expect(() => new EventFirehose({})).toThrow(TypeError);
    expect(() => new EventFirehose({ session: {} })).toThrow(TypeError);
    expect(() => new EventFirehose({ session: { broadcast() {} } }).catchUp({})).toThrow(TypeError);

    const session = new GameSession({
      roomCode: "TESTROOM01",
      usernames: ["Alice", "Bob"],
      seed: 1,
      createGame: () => createTestGame(),
    });
    expect(() => new EventFirehose({ session }).subscribe()).toThrow(
      "EventFirehose.subscribe requires the session's game to be started."
    );
  });

  test("the session's firehose switch defaults to on", () => {
    const { session } = makeSession();
    expect(session.isFirehoseEnabled).toBe(true);
    session.setFirehoseEnabled(false);
    expect(session.isFirehoseEnabled).toBe(false);
    session.setFirehoseEnabled(true);
    expect(session.isFirehoseEnabled).toBe(true);
    expect(() => session.setFirehoseEnabled("yes")).toThrow(TypeError);
  });
});
