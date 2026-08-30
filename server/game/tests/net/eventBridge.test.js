import { jest } from "@jest/globals";
import EVT from "../../EventCatalog.js";
import EventBridge from "../../net/EventBridge.js";
import GameSession from "../../net/GameSession.js";
import { EVENTS } from "../../net/protocol.js";
import { createTestGame, deployUnit, setupGameWithHands } from "../utils.js";

const USERNAMES = ["Alice", "Bob"];

const makeConnection = () => ({
  sent: [],
  send(event, payload) {
    this.sent.push({ event, payload });
  },
});

const makeSessionWithConnections = (game) => {
  const session = new GameSession({
    roomCode: "ROOM1",
    usernames: USERNAMES,
    seed: 1,
    createGame: () => game,
  });
  const alice = makeConnection();
  const bob = makeConnection();
  session.attach("Alice", alice);
  session.attach("Bob", bob);
  session.ensureGame();
  return { session, alice, bob };
};

describe("EventBridge", () => {
  test("requires a session and a started game", () => {
    expect(() => new EventBridge({ session: null })).toThrow(TypeError);
    const unstarted = new GameSession({
      roomCode: "ROOM1",
      usernames: USERNAMES,
      seed: 1,
      createGame: () => createTestGame(),
    });
    expect(() => new EventBridge({ session: unstarted }).subscribe()).toThrow(/game to be started/);
  });

  test("a peek ability delivers the revealed cards to the observer's connections only", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Shinheuh"] });
    const { session, alice, bob } = makeSessionWithConnections(game);
    new EventBridge({ session }).subscribe();

    const scout = deployUnit(game, "Alice", "Test Scout", "scout");
    // Deploying ends the deployer's turn; the test drives the peek like the
    // other integration suites do, by re-pointing the turn at the actor.
    game.currentTurn = "Alice";
    game.processAction({
      type: "use-ability-action",
      data: { source: "player", username: "Alice", unitId: scout.id, abilityCode: "0" },
    });

    expect(alice.sent).toHaveLength(1);
    const { event, payload } = alice.sent[0];
    expect(event).toBe(EVENTS.GAME_HAND_PEEK);
    expect(payload.owner).toBe("Bob");
    expect(payload.observer).toBe("Alice");
    expect(payload.cards).toHaveLength(1);
    expect(payload.cards[0]).toEqual(
      expect.objectContaining({ name: expect.any(String), cost: expect.any(Number) })
    );
    expect(bob.sent).toEqual([]);
  });

  test("unsubscribing stops delivery", () => {
    const game = createTestGame();
    const { session, alice } = makeSessionWithConnections(game);
    const unsubscribe = new EventBridge({ session }).subscribe();

    unsubscribe();
    game.eventBus.emit(EVT.HAND_PEEKED, {
      owner: "Bob",
      observer: "Alice",
      cards: [{ id: 5, name: "Test Shinheuh", cost: 2, type: "unit" }],
    });

    expect(alice.sent).toEqual([]);
  });

  test("a delivery failure stays isolated from the authoritative event chain", () => {
    const game = createTestGame();
    const { session } = makeSessionWithConnections(game);
    const failing = makeConnection();
    failing.send = () => {
      throw new Error("transport exploded");
    };
    session.attach("Alice", failing);
    new EventBridge({ session }).subscribe();

    const result = game.eventBus.emit(EVT.HAND_PEEKED, {
      owner: "Bob",
      observer: "Alice",
      cards: [{ id: 5, name: "Test Shinheuh", cost: 2, type: "unit" }],
    });

    expect(result.observerErrors).toHaveLength(1);
  });
});
