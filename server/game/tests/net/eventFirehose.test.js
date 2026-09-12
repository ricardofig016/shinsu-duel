import EventFirehose from "../../net/eventFirehose.js";
import GameSession from "../../net/GameSession.js";
import { EVENTS } from "../../net/protocol.js";
import { createTestGame } from "../utils.js";

/**
 * The firehose is a net-layer diagnostic: it only reads engine events and
 * hands compact lines to a session, so it is driven here through a real
 * `GameSession` whose game is a fixture-catalog game.
 */

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
    expect(alice.map((line) => line.name)).toEqual(["turn:ended", "turn:started"]);
    expect(alice[0].sequence).toBe(1);
    expect(alice[1].sequence).toBe(2);
    expect(alice[0].fields.username).toBe("Alice");

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
    expect(lines.map((line) => line.name)).toEqual(["test:root"]);
    expect(lines[0].fields).toEqual({ username: "Bob" });

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

    expect(linesOf(received, "Alice").map((line) => line.name)).toEqual(["test:first", "test:again"]);
    // Sequence numbers count streamed lines only.
    expect(linesOf(received, "Alice").map((line) => line.sequence)).toEqual([1, 2]);

    unsubscribe();
  });

  test("unsubscribing stops the stream", () => {
    const { session, received, game } = makeSession();
    const unsubscribe = new EventFirehose({ session }).subscribe();

    game.eventBus.emit("test:before", {});
    unsubscribe();
    game.eventBus.emit("test:after", {});

    expect(linesOf(received, "Alice").map((line) => line.name)).toEqual(["test:before"]);
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
