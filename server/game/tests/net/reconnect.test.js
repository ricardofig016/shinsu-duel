import { jest } from "@jest/globals";
import { EVENTS, buildStateView } from "../../net/protocol.js";
import { createNetHarness } from "./harness.js";

jest.setTimeout(15000);

const PASS_TURN = { type: "pass-turn-action", data: {} };

let harness;

beforeEach(async () => {
  harness = await createNetHarness();
});

afterEach(async () => {
  await harness.close();
});

/** Create a pending target-selection decision for Alice on the live game. */
function createTargetDecision(session) {
  return session.game.createPendingDecision({
    owner: "Alice",
    type: "target_selection",
    candidates: [{ id: 77, name: "Candidate", hp: 4 }],
    minChoices: 1,
    maxChoices: 1,
    resolve: () => {},
  });
}

/** Connect one player and resolve once its state view has arrived. */
async function connectAndAwaitInit(username, roomCode) {
  const client = await harness.connectPlayer({ username, roomCode });
  await harness.waitFor(
    () => client.lastPayloadOf(EVENTS.GAME_INIT) !== null,
    `${username} reconnected but never received game-init.`
  );
  return client;
}

describe("one player drops and rejoins", () => {
  test("the rejoin delivers the current state including the open decision", async () => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const game = session.game;

    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    await alice.next(EVENTS.GAME_UPDATE);
    const decisionId = createTargetDecision(session);
    const revision = session.revision;

    alice.disconnect();
    const rejoined = await connectAndAwaitInit("Alice", roomCode);
    const view = rejoined.lastPayloadOf(EVENTS.GAME_INIT);

    expect(view.revision).toBe(revision);
    expect(view.currentTurn).toBe("Bob");
    expect(view.you.pendingDecision).toEqual({
      decisionId,
      type: "target_selection",
      candidates: [{ id: 77, name: "Candidate", hp: 4, _isUnit: false }],
      minChoices: 1,
      maxChoices: 1,
      lockedIds: [],
    });
    expect(harness.registry.get(roomCode)).toBe(session);
    expect(session.game).toBe(game);
    expect(harness.createGameCalls).toBe(1);
  });

  test("the rejoined player resolves the open decision over the wire", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);

    const decisionId = createTargetDecision(session);
    alice.disconnect();
    const rejoined = await connectAndAwaitInit("Alice", roomCode);
    const revisionBefore = session.revision;

    rejoined.emit(EVENTS.GAME_DECISION, { decisionId, choices: [77] });
    const [aliceUpdate, bobUpdate] = await Promise.all([rejoined.next(EVENTS.GAME_UPDATE), bob.next(EVENTS.GAME_UPDATE)]);

    expect(session.game.pendingDecision).toBeNull();
    expect(aliceUpdate.revision).toBe(revisionBefore + 1);
    expect(bobUpdate.revision).toBe(revisionBefore + 1);
  });
});

describe("both players leave and rejoin", () => {
  test("memory resume restores the exact game without recreation", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const game = session.game;

    const pass1 = Promise.all([alice.next(EVENTS.GAME_UPDATE), bob.next(EVENTS.GAME_UPDATE)]);
    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    await pass1;

    const pass2 = Promise.all([alice.next(EVENTS.GAME_UPDATE), bob.next(EVENTS.GAME_UPDATE)]);
    bob.emit(EVENTS.GAME_ACTION, PASS_TURN);
    await pass2;
    const revision = session.revision;

    alice.disconnect();
    bob.disconnect();
    await harness.waitFor(
      () => session.isEmpty(),
      "session seats never emptied after both players left."
    );
    expect(harness.registry.get(roomCode)).toBe(session);
    expect(session.isStarted).toBe(true);
    expect(session.game).toBe(game);

    const aliceRejoined = await connectAndAwaitInit("Alice", roomCode);
    const bobRejoined = await connectAndAwaitInit("Bob", roomCode);
    const aliceView = aliceRejoined.lastPayloadOf(EVENTS.GAME_INIT);
    const bobView = bobRejoined.lastPayloadOf(EVENTS.GAME_INIT);

    expect(aliceView.revision).toBe(revision);
    expect(aliceView.round).toBe(2);
    expect(aliceView.currentTurn).toBe("Alice");
    expect(aliceView).toEqual(
      buildStateView({ game: session.game, revision: session.revision, username: "Alice" })
    );
    expect(bobView.you.username).toBe("Bob");
    expect(session.game).toBe(game);
    expect(harness.createGameCalls).toBe(1);
  });
});

describe("no session recreation after a disconnect", () => {
  test("a lone rejoin resumes the started game instead of creating a new one", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const game = session.game;

    alice.disconnect();
    bob.disconnect();
    await harness.waitFor(
      () => session.isEmpty(),
      "session seats never emptied after both players left."
    );

    const rejoined = await connectAndAwaitInit("Alice", roomCode);

    expect(harness.registry.get(roomCode)).toBe(session);
    expect(session.game).toBe(game);
    expect(harness.createGameCalls).toBe(1);
    // Exactly the personal state view: no second start broadcast.
    expect(rejoined.payloadsOf(EVENTS.GAME_INIT)).toHaveLength(1);
    expect(rejoined.lastPayloadOf(EVENTS.GAME_INIT).revision).toBe(1);
  });
});

describe("two tabs for one player act as one seat", () => {
  test("both tabs share the seat and one surviving tab keeps receiving updates", async () => {
    const { roomCode, alice, bob } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);
    const tab2 = await connectAndAwaitInit("Alice", roomCode);

    expect(session.connectionCount("Alice")).toBe(2);
    // The second tab receives the personal state view of the started game.
    expect(tab2.lastPayloadOf(EVENTS.GAME_INIT).you.username).toBe("Alice");

    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    const [tab1Update, tab2Update, bobUpdate] = await Promise.all([
      alice.next(EVENTS.GAME_UPDATE),
      tab2.next(EVENTS.GAME_UPDATE),
      bob.next(EVENTS.GAME_UPDATE),
    ]);
    expect(tab1Update.revision).toBe(2);
    expect(tab2Update.revision).toBe(2);
    expect(bobUpdate.revision).toBe(2);

    alice.disconnect();
    await harness.waitFor(
      () => session.connectionCount("Alice") === 1,
      "the first tab's disconnect never reached the session."
    );

    bob.emit(EVENTS.GAME_ACTION, PASS_TURN);
    const update = await tab2.next(EVENTS.GAME_UPDATE);
    expect(update.round).toBe(2);
    expect(update.currentTurn).toBe("Alice");
  });
});

describe("game-state-request over the wire", () => {
  test("answers with the exact current view of the requesting seat", async () => {
    const { roomCode, alice } = await harness.seatPlayers();
    const session = harness.registry.get(roomCode);

    alice.emit(EVENTS.GAME_ACTION, PASS_TURN);
    await alice.next(EVENTS.GAME_UPDATE);
    alice.emit(EVENTS.GAME_STATE_REQUEST);

    const view = await alice.next(EVENTS.GAME_INIT);
    expect(view).toEqual(
      buildStateView({ game: session.game, revision: session.revision, username: "Alice" })
    );
  });

  test("answers with game-waiting while the room is incomplete", async () => {
    const roomCode = harness.createRoom();
    harness.joinRoom(roomCode, "Alice");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode });

    alice.emit(EVENTS.GAME_STATE_REQUEST);

    expect(await alice.next(EVENTS.GAME_WAITING)).toEqual({
      message: "Waiting for the other player to join.",
    });
  });
});
