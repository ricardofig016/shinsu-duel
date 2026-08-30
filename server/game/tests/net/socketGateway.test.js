import { jest } from "@jest/globals";
import SocketGateway from "../../net/socketGateway.js";
import SessionRegistry from "../../net/SessionRegistry.js";
import { EVENTS, TRANSPORT_EVENTS, buildWaitingPayload } from "../../net/protocol.js";
import { createTestGame } from "../utils.js";

const ROOM = "ROOM1";
const SEED = 42;

const makeSocket = ({ roomCode, username }) => {
  const socket = {
    handshake: { query: { roomCode } },
    request: { session: { username } },
    emitted: [],
    handlers: new Map(),
    closed: false,
    emit(event, payload) {
      socket.emitted.push({ event, payload });
    },
    on(event, handler) {
      socket.handlers.set(event, handler);
    },
    disconnect() {
      socket.closed = true;
    },
    trigger(event, payload) {
      socket.handlers.get(event)?.(payload);
    },
    payloadsOf(event) {
      return socket.emitted.filter((entry) => entry.event === event).map((entry) => entry.payload);
    },
    lastPayloadOf(event) {
      const payloads = socket.payloadsOf(event);
      return payloads[payloads.length - 1] ?? null;
    },
  };
  return socket;
};

const makeHarness = ({ rooms, logger = null } = {}) => {
  const registry = new SessionRegistry();
  const createdGames = [];
  const createGame = jest.fn(() => {
    const game = createTestGame();
    createdGames.push(game);
    return game;
  });
  const gateway = new SocketGateway({
    registry,
    loadRoom: async (roomCode) => rooms[roomCode] ?? null,
    createGame,
    logger,
  });

  let connectionHandler = null;
  const io = { of: () => ({ on: (event, handler) => (connectionHandler = handler) }) };
  gateway.attach(io);
  const connect = async ({ roomCode, username }) => {
    const socket = makeSocket({ roomCode, username });
    await connectionHandler(socket);
    return socket;
  };

  return { registry, createdGames, createGame, connect };
};

const fullRoom = () => ({ [ROOM]: { players: ["Alice", "Bob"], seed: SEED } });
const loneRoom = () => ({ [ROOM]: { players: ["Alice"], seed: SEED } });

const passTurn = { type: "pass-turn-action", data: {} };

describe("SocketGateway construction", () => {
  test.each([
    ["registry", { loadRoom: async () => null, createGame: () => {} }],
    ["loadRoom", { registry: new SessionRegistry(), createGame: () => {} }],
    ["createGame", { registry: new SessionRegistry(), loadRoom: async () => null }],
  ])("rejects a missing %s", (_label, partial) => {
    expect(() => new SocketGateway(partial)).toThrow(TypeError);
  });
});

describe("connection validation", () => {
  test("rejects an unknown room", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });

    const socket = await connect({ roomCode: "NOPE", username: "Alice" });

    expect(socket.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({ message: expect.any(String) });
    expect(socket.closed).toBe(true);
    expect(registry.size).toBe(0);
  });

  test("rejects a username that is not a room participant", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });

    const socket = await connect({ roomCode: ROOM, username: "Mallory" });

    expect(socket.closed).toBe(true);
    expect(registry.size).toBe(0);
  });

  test("rejects a connection without an authenticated username", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });

    const socket = await connect({ roomCode: ROOM, username: undefined });

    expect(socket.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({ message: expect.any(String) });
    expect(socket.closed).toBe(true);
    expect(registry.size).toBe(0);
  });
});

describe("waiting for the room to complete", () => {
  test("a lone player in an unfinished room is parked with game-waiting and no session", async () => {
    const { registry, createGame, connect } = makeHarness({ rooms: loneRoom() });

    const socket = await connect({ roomCode: ROOM, username: "Alice" });

    expect(socket.lastPayloadOf(EVENTS.GAME_WAITING)).toEqual(buildWaitingPayload());
    expect(socket.closed).toBe(false);
    expect(registry.size).toBe(0);
    expect(createGame).not.toHaveBeenCalled();
  });

  test("the parked player receives game-init once a later connection completes the room", async () => {
    const rooms = loneRoom();
    const { registry, createGame, connect } = makeHarness({ rooms });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });

    rooms[ROOM].players.push("Bob");
    const bob = await connect({ roomCode: ROOM, username: "Bob" });

    const aliceInits = alice.payloadsOf(EVENTS.GAME_INIT);
    expect(aliceInits).toHaveLength(1);
    expect(bob.payloadsOf(EVENTS.GAME_INIT)).toHaveLength(1);
    expect(aliceInits[0].you.username).toBe("Alice");
    expect(bob.payloadsOf(EVENTS.GAME_INIT)[0].you.username).toBe("Bob");
    expect(registry.get(ROOM).isStarted).toBe(true);
    expect(createGame).toHaveBeenCalledTimes(1);
  });
});

describe("session-backed connections", () => {
  test("a waiting player is notified when the second seat connects and the game starts", async () => {
    const { registry, createGame, connect } = makeHarness({ rooms: fullRoom() });

    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    expect(alice.lastPayloadOf(EVENTS.GAME_WAITING)).toEqual(buildWaitingPayload());
    expect(registry.get(ROOM).isStarted).toBe(false);

    const bob = await connect({ roomCode: ROOM, username: "Bob" });

    const aliceInit = alice.lastPayloadOf(EVENTS.GAME_INIT);
    const bobInit = bob.lastPayloadOf(EVENTS.GAME_INIT);
    expect(aliceInit).not.toBeNull();
    expect(bobInit).not.toBeNull();
    expect(aliceInit.revision).toBe(1);
    expect(aliceInit.you.username).toBe("Alice");
    expect(bobInit.you.username).toBe("Bob");
    expect(registry.get(ROOM).isStarted).toBe(true);
    expect(createGame).toHaveBeenCalledTimes(1);
  });

  test("each seat receives its own projection: opponent hands stay hidden", async () => {
    const { connect } = makeHarness({ rooms: fullRoom() });
    await connect({ roomCode: ROOM, username: "Alice" });
    const bob = await connect({ roomCode: ROOM, username: "Bob" });

    const bobInit = bob.lastPayloadOf(EVENTS.GAME_INIT);
    expect(bobInit.you.hand.length).toBeGreaterThan(0);
    for (const card of bobInit.opponent.hand) {
      expect(card).toEqual({});
    }
  });

  test("duplicate sockets on one seat share the session and both receive updates", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });
    const aliceTab1 = await connect({ roomCode: ROOM, username: "Alice" });
    const aliceTab2 = await connect({ roomCode: ROOM, username: "Alice" });
    await connect({ roomCode: ROOM, username: "Bob" });

    expect(registry.get(ROOM).connectionCount("Alice")).toBe(2);

    aliceTab1.trigger(EVENTS.GAME_ACTION, passTurn);

    expect(aliceTab1.lastPayloadOf(EVENTS.GAME_UPDATE)).not.toBeNull();
    expect(aliceTab2.lastPayloadOf(EVENTS.GAME_UPDATE)).not.toBeNull();
  });

  test("reconnecting after a disconnect resumes the same session and game", async () => {
    const { registry, createdGames, createGame, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    await connect({ roomCode: ROOM, username: "Bob" });

    alice.trigger(TRANSPORT_EVENTS.DISCONNECT);
    expect(registry.get(ROOM)).not.toBeNull();
    expect(registry.get(ROOM).connectionCount("Alice")).toBe(0);

    const rejoined = await connect({ roomCode: ROOM, username: "Alice" });

    const init = rejoined.lastPayloadOf(EVENTS.GAME_INIT);
    expect(init).not.toBeNull();
    expect(init.you.username).toBe("Alice");
    expect(registry.get(ROOM).game).toBe(createdGames[0]);
    expect(createGame).toHaveBeenCalledTimes(1);
  });

  test("no session recreation when every player leaves", async () => {
    const { registry, createdGames, createGame, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    const bob = await connect({ roomCode: ROOM, username: "Bob" });

    alice.trigger(TRANSPORT_EVENTS.DISCONNECT);
    bob.trigger(TRANSPORT_EVENTS.DISCONNECT);

    expect(registry.size).toBe(1);
    expect(registry.get(ROOM).game).toBe(createdGames[0]);
    expect(registry.get(ROOM).isEmpty()).toBe(true);
    expect(createGame).toHaveBeenCalledTimes(1);
  });
});

describe("game-state-request", () => {
  test("answers with the current state view once the game is started", async () => {
    const { connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    await connect({ roomCode: ROOM, username: "Bob" });
    alice.trigger(EVENTS.GAME_ACTION, passTurn);

    alice.trigger(EVENTS.GAME_STATE_REQUEST);

    const view = alice.lastPayloadOf(EVENTS.GAME_INIT);
    expect(view.currentTurn).toBe("Bob");
    expect(view.round).toBe(1);
    expect(view.revision).toBe(2);
  });

  test("answers with game-waiting before the game exists", async () => {
    const { connect } = makeHarness({ rooms: loneRoom() });

    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    alice.trigger(EVENTS.GAME_STATE_REQUEST);

    expect(alice.lastPayloadOf(EVENTS.GAME_WAITING)).toEqual(buildWaitingPayload());
  });
});

describe("inbound action validation", () => {
  const makeStartedHarness = async () => {
    const harness = makeHarness({ rooms: fullRoom() });
    const alice = await harness.connect({ roomCode: ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: ROOM, username: "Bob" });
    return { ...harness, alice, bob };
  };

  test.each([
    ["null payload", null],
    ["missing type", { data: {} }],
    ["empty type", { type: "", data: {} }],
    ["data is not an object", { type: "pass-turn-action", data: "nope" }],
  ])("rejects %s before the engine sees it", async (_label, action) => {
    const { alice, registry } = await makeStartedHarness();
    const session = registry.get(ROOM);
    const revisionBefore = session.revision;

    alice.trigger(EVENTS.GAME_ACTION, action);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({ message: "Malformed action payload." });
    expect(session.revision).toBe(revisionBefore);
    expect(session.game.round).toBe(1);
  });

  test("an unknown action type is rejected by the engine and changes nothing", async () => {
    const { alice, registry } = await makeStartedHarness();
    const session = registry.get(ROOM);

    alice.trigger(EVENTS.GAME_ACTION, { type: "nope-action", data: {} });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/invalid action type/);
    expect(session.revision).toBe(1);
    expect(session.game.currentTurn).toBe("Alice");
  });

  test("identity is stamped from the connection, not from the payload", async () => {
    const { alice, bob, registry } = await makeStartedHarness();
    const session = registry.get(ROOM);

    // Bob claims to be Alice; if the claim were trusted, the pass would succeed.
    bob.trigger(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: { username: "Alice" } });

    expect(bob.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/not your turn/);
    expect(session.game.currentTurn).toBe("Alice");
    expect(alice.payloadsOf(EVENTS.GAME_UPDATE)).toHaveLength(0);
  });

  test("an accepted action broadcasts a bumped state view to every seat", async () => {
    const { alice, bob, registry } = await makeStartedHarness();

    alice.trigger(EVENTS.GAME_ACTION, passTurn);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
    expect(update.revision).toBe(2);
    expect(update.currentTurn).toBe("Bob");
    expect(bob.lastPayloadOf(EVENTS.GAME_UPDATE).currentTurn).toBe("Bob");
  });
});

describe("inbound decision validation", () => {
  const makeHarnessWithDecision = async () => {
    const harness = makeHarness({ rooms: fullRoom() });
    const alice = await harness.connect({ roomCode: ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: ROOM, username: "Bob" });
    const game = harness.createdGames[0];
    const decisionId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: 77, name: "Candidate", hp: 4 }],
      minChoices: 1,
      maxChoices: 1,
      resolve: () => {},
    });
    return { ...harness, alice, bob, game, decisionId };
  };

  test.each([
    ["null payload", null],
    ["missing decision id", { choices: [77] }],
    ["choices is not an array", { decisionId: "d1", choices: "77" }],
  ])("rejects %s before the engine sees it", async (_label, decision) => {
    const { alice, registry } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    alice.trigger(EVENTS.GAME_DECISION, decision);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({ message: "Malformed decision payload." });
    expect(session.game.pendingDecision).not.toBeNull();
  });

  test("a wrong decision id is rejected and leaves the decision open", async () => {
    const { alice, registry } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    alice.trigger(EVENTS.GAME_DECISION, { decisionId: "nope", choices: [77] });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/Decision ID does not match/);
    expect(session.game.pendingDecision).not.toBeNull();
    expect(session.revision).toBe(1);
  });

  test("a valid decision resolves and broadcasts the update", async () => {
    const { alice, bob, registry, decisionId } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    alice.trigger(EVENTS.GAME_DECISION, { decisionId, choices: [77] });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    expect(session.game.pendingDecision).toBeNull();
    expect(session.revision).toBe(2);
    expect(alice.lastPayloadOf(EVENTS.GAME_UPDATE).revision).toBe(2);
    expect(bob.lastPayloadOf(EVENTS.GAME_UPDATE).revision).toBe(2);
  });

  test("only the decision owner may resolve it", async () => {
    const { bob, registry } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    bob.trigger(EVENTS.GAME_DECISION, { decisionId: session.game.pendingDecision.decisionId, choices: [77] });

    expect(bob.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/Only the decision owner/);
    expect(session.game.pendingDecision).not.toBeNull();
  });
});

describe("game over", () => {
  const makeEndedGameHarness = async () => {
    const harness = makeHarness({ rooms: fullRoom() });
    const alice = await harness.connect({ roomCode: ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: ROOM, username: "Bob" });
    const game = harness.createdGames[0];
    game.playerStates.Alice.deck = [];
    alice.trigger(EVENTS.GAME_ACTION, passTurn);
    bob.trigger(EVENTS.GAME_ACTION, passTurn);
    return { ...harness, alice, bob, game };
  };

  test("the ending action broadcasts game-over and the final state", async () => {
    const { alice, bob } = await makeEndedGameHarness();

    for (const socket of [alice, bob]) {
      expect(socket.lastPayloadOf(EVENTS.GAME_OVER)).toEqual({
        winner: "Bob",
        reason: "deck exhausted",
      });
      expect(socket.lastPayloadOf(EVENTS.GAME_UPDATE).gameOver).toEqual({
        winner: "Bob",
        reason: "deck exhausted",
      });
    }
  });

  test("actions after game over return the result without touching state", async () => {
    const { alice, registry } = await makeEndedGameHarness();
    const session = registry.get(ROOM);
    const revision = session.revision;

    alice.trigger(EVENTS.GAME_ACTION, passTurn);

    expect(alice.lastPayloadOf(EVENTS.GAME_OVER)).toEqual({ winner: "Bob", reason: "deck exhausted" });
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(0);
    expect(session.revision).toBe(revision);
  });
});
