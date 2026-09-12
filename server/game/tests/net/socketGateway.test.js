import SocketGateway from "../../net/socketGateway.js";
import SessionRegistry from "../../net/SessionRegistry.js";
import { EVENTS, TRANSPORT_EVENTS, ERROR_CODES, buildWaitingPayload, buildDeckStatus } from "../../net/protocol.js";
import { cards } from "../fixtures/cards.js";
import {
  ROOM,
  DEV_ROOM,
  SEED,
  legalSlugs,
  slugToCardId,
  unreachableSlug,
  makeSocket,
  makeDeckLibrary,
  makeHarness,
  fullRoom,
  devRoom,
  loneRoom,
  makeStartedHarness,
  passTurn,
} from "./gatewayHarness.js";

describe("SocketGateway construction", () => {
  test.each([
    ["registry", { loadRoom: async () => null, createGame: () => {} }],
    ["loadRoom", { registry: new SessionRegistry(), createGame: () => {} }],
    ["createGame", { registry: new SessionRegistry(), loadRoom: async () => null }],
    ["deckLibrary", { registry: new SessionRegistry(), loadRoom: async () => null, createGame: () => {}, catalog: cards }],
    ["catalog", { registry: new SessionRegistry(), loadRoom: async () => null, createGame: () => {}, deckLibrary: makeDeckLibrary() }],
    [
      "isAccountActive",
      {
        registry: new SessionRegistry(),
        loadRoom: async () => null,
        createGame: () => {},
        deckLibrary: makeDeckLibrary(),
        catalog: cards,
      },
    ],
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

    expect(socket.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({
      message: expect.any(String),
      code: ERROR_CODES.UNAUTHENTICATED,
    });
    expect(socket.closed).toBe(true);
    expect(registry.size).toBe(0);
  });

  test("rejects a connection whose account no longer exists", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom(), isAccountActive: async () => false });

    const socket = await connect({ roomCode: ROOM, username: "Alice" });

    expect(socket.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({
      message: expect.any(String),
      code: ERROR_CODES.UNAUTHENTICATED,
    });
    expect(socket.closed).toBe(true);
    expect(registry.size).toBe(0);
  });

  test("rejects a connection without a room code, without an identity code", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });

    const socket = await connect({ roomCode: undefined, username: "Alice" });

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

  test("the parked player reaches the selection phase and then game-init once the room completes", async () => {
    const rooms = loneRoom();
    const { registry, createGame, deckLibrary, connect } = makeHarness({ rooms });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });

    rooms[ROOM].players.push("Bob");
    const bob = await connect({ roomCode: ROOM, username: "Bob" });

    // Both seats are connected, so the deck-selection phase is announced.
    expect(alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS)).not.toBeNull();
    expect(bob.lastPayloadOf(EVENTS.GAME_DECK_STATUS)).not.toBeNull();
    expect(registry.get(ROOM).isStarted).toBe(false);

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: deckLibrary.createDeck({ owner: "Alice", name: "A", cards: legalSlugs() }).id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: deckLibrary.createDeck({ owner: "Bob", name: "B", cards: legalSlugs() }).id });

    const aliceInits = alice.payloadsOf(EVENTS.GAME_INIT);
    expect(aliceInits).toHaveLength(1);
    expect(bob.payloadsOf(EVENTS.GAME_INIT)).toHaveLength(1);
    expect(aliceInits[0].you.username).toBe("Alice");
    expect(bob.payloadsOf(EVENTS.GAME_INIT)[0].you.username).toBe("Bob");
    expect(registry.get(ROOM).isStarted).toBe(true);
    expect(createGame).toHaveBeenCalledTimes(1);
  });
});

describe("deck selection phase", () => {
  test("a lone seat picks while waiting and the broadcast carries its pick", async () => {
    const { registry, deckLibrary, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });

    expect(alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS)).toEqual(
      buildDeckStatus({
        dev: false,
        seats: [
          { username: "Alice", deckChosen: false, deckId: null, deckName: null, illegal: false },
          { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
        ],
      })
    );

    const deck = deckLibrary.createDeck({ owner: "Alice", name: "Alice's deck", cards: legalSlugs() });
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: deck.id });

    const session = registry.get(ROOM);
    expect(session.getDeckPick("Alice")).toEqual({
      deckId: deck.id,
      name: "Alice's deck",
      cards: legalSlugs(),
      illegal: false,
    });
    expect(session.isStarted).toBe(false);
    expect(alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS)).toEqual(
      buildDeckStatus({
        dev: false,
        seats: [
          { username: "Alice", deckChosen: true, deckId: "deck-1", deckName: "Alice's deck", illegal: false },
          { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
        ],
      })
    );
  });

  test("a re-pick replaces the earlier pick", async () => {
    const { registry, deckLibrary, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    const first = deckLibrary.createDeck({ owner: "Alice", name: "First", cards: legalSlugs() });
    const second = deckLibrary.createDeck({ owner: "Alice", name: "Second", cards: legalSlugs() });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: first.id });
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: second.id });

    expect(registry.get(ROOM).getDeckPick("Alice").deckId).toBe(second.id);
    expect(registry.get(ROOM).getDeckPick("Alice").name).toBe("Second");
  });

  test("an unknown deck is rejected", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: "deck-nope" });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Deck not found.");
    expect(registry.get(ROOM).getDeckPick("Alice")).toBeNull();
  });

  test("another player's deck is rejected", async () => {
    const { deckLibrary, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    const foreign = deckLibrary.createDeck({ owner: "Bob", name: "Bob's deck", cards: legalSlugs() });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: foreign.id });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("Deck not found.");
  });

  test("an unbuildable deck is rejected with per-card problems", async () => {
    const { registry, deckLibrary, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    const broken = deckLibrary.createDeck({ owner: "Alice", name: "Broken", cards: ["no_such_slug", ...legalSlugs().slice(1)] });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: broken.id });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("unknown cards");
    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("no_such_slug");
    expect(registry.get(ROOM).getDeckPick("Alice")).toBeNull();
  });

  test("an illegal deck is rejected in a normal room", async () => {
    const { registry, deckLibrary, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    const illegal = deckLibrary.createDeck({ owner: "Alice", name: "Illegal", cards: [unreachableSlug(), ...legalSlugs().slice(1)] });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: illegal.id });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toContain("not legal");
    expect(registry.get(ROOM).getDeckPick("Alice")).toBeNull();
  });

  test("an illegal deck is accepted in a dev room and marked in the status", async () => {
    const { registry, deckLibrary, connect } = makeHarness({ rooms: devRoom() });
    const alice = await connect({ roomCode: DEV_ROOM, username: "Alice" });
    const bob = await connect({ roomCode: DEV_ROOM, username: "Bob" });
    const illegal = deckLibrary.createDeck({ owner: "Alice", name: "Illegal", cards: [unreachableSlug(), ...legalSlugs().slice(1)] });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: illegal.id });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    expect(registry.get(DEV_ROOM).getDeckPick("Alice").illegal).toBe(true);
    expect(bob.lastPayloadOf(EVENTS.GAME_DECK_STATUS)).toEqual(
      buildDeckStatus({
        dev: true,
        seats: [
          { username: "Alice", deckChosen: true, deckId: "deck-1", deckName: "Illegal", illegal: true },
          { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
        ],
      })
    );
  });

  test("rejects a malformed payload", async () => {
    const { connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, null);
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: "" });

    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(2);
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)[0].message).toBe("Malformed deck selection payload.");
  });

  test("rejects a pick after the game started", async () => {
    const { registry, deckLibrary, alice } = await makeStartedHarness();
    const late = deckLibrary.createDeck({ owner: "Alice", name: "Late", cards: legalSlugs() });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: late.id });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toBe("The game has already started.");
    expect(registry.get(ROOM).isStarted).toBe(true);
  });

  test("starts with both picks, passing the resolved decks and the enforcement flag to the factory", async () => {
    const { registry, createGame, aliceDeck, bobDeck } = await makeStartedHarness();

    const session = registry.get(ROOM);
    expect(session.isStarted).toBe(true);
    expect(createGame).toHaveBeenCalledTimes(1);
    expect(createGame).toHaveBeenCalledWith({
      roomCode: ROOM,
      usernames: ["Alice", "Bob"],
      seed: SEED,
      decks: { Alice: slugToCardId(aliceDeck.cards), Bob: slugToCardId(bobDeck.cards) },
      enforceDeckRules: true,
    });
    // Picks are cleared once the game started.
    expect(session.getDeckPick("Alice")).toBeNull();
    expect(session.getDeckPick("Bob")).toBeNull();
  });

  test("a dev room starts with enforcement disabled when an illegal deck was picked", async () => {
    const harness = makeHarness({ rooms: devRoom() });
    const alice = await harness.connect({ roomCode: DEV_ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: DEV_ROOM, username: "Bob" });
    const illegal = harness.deckLibrary.createDeck({ owner: "Alice", name: "Illegal", cards: [unreachableSlug(), ...legalSlugs().slice(1)] });
    const legal = harness.deckLibrary.createDeck({ owner: "Bob", name: "Legal", cards: legalSlugs() });

    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: illegal.id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: legal.id });

    expect(harness.registry.get(DEV_ROOM).isStarted).toBe(true);
    expect(harness.createGame).toHaveBeenCalledWith(expect.objectContaining({ enforceDeckRules: false }));
  });

  test("a pick whose deck was deleted between pick and start returns the seat to selection", async () => {
    const harness = makeHarness({ rooms: fullRoom() });
    const alice = await harness.connect({ roomCode: ROOM, username: "Alice" });
    await harness.connect({ roomCode: ROOM, username: "Bob" });
    const doomed = harness.deckLibrary.createDeck({ owner: "Alice", name: "Doomed", cards: legalSlugs() });
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: doomed.id });

    harness.deckLibrary.decks.delete(doomed.id);
    const bob = await harness.connect({ roomCode: ROOM, username: "Bob" });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: harness.deckLibrary.createDeck({ owner: "Bob", name: "Bob's deck", cards: legalSlugs() }).id });

    const session = harness.registry.get(ROOM);
    expect(session.isStarted).toBe(false);
    expect(session.getDeckPick("Alice")).toBeNull();
    const status = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(status.seats.find((seat) => seat.username === "Alice").deckChosen).toBe(false);
  });

  test("a seat whose deck became illegal between pick and start returns to selection in a normal room", async () => {
    const harness = makeHarness({ rooms: fullRoom() });
    const alice = await harness.connect({ roomCode: ROOM, username: "Alice" });
    await harness.connect({ roomCode: ROOM, username: "Bob" });
    const deck = harness.deckLibrary.createDeck({ owner: "Alice", name: "Edited", cards: legalSlugs() });
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: deck.id });

    // The deck is edited in another tab between pick and start.
    harness.deckLibrary.decks.set(deck.id, { ...deck, cards: [unreachableSlug(), ...legalSlugs().slice(1)] });
    const bob = await harness.connect({ roomCode: ROOM, username: "Bob" });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: harness.deckLibrary.createDeck({ owner: "Bob", name: "Bob's deck", cards: legalSlugs() }).id });

    const session = harness.registry.get(ROOM);
    expect(session.isStarted).toBe(false);
    expect(session.getDeckPick("Alice")).toBeNull();
  });
  test("concurrent picks start the game exactly once", async () => {
    const harness = makeHarness({ rooms: fullRoom() });
    const alice = await harness.connect({ roomCode: ROOM, username: "Alice" });
    const bob = await harness.connect({ roomCode: ROOM, username: "Bob" });

    // Gate the deck library so both picks resolve only after both seats have
    // entered the start path: this forces the interleaving the guard exists for.
    const deferred = [];
    const library = harness.deckLibrary;
    const originalGet = library.getOwnedDeck.bind(library);
    library.getOwnedDeck = (...args) =>
      new Promise((resolve) => deferred.push(() => resolve(originalGet(...args))));

    const aliceDeck = library.createDeck({ owner: "Alice", name: "A", cards: legalSlugs() });
    const bobDeck = library.createDeck({ owner: "Bob", name: "B", cards: legalSlugs() });
    await alice.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });

    // Both picks are stored and both start attempts are suspended on the gate.
    const session = harness.registry.get(ROOM);
    expect(session.isStarted).toBe(false);
    const statusCount = {
      Alice: alice.payloadsOf(EVENTS.GAME_DECK_STATUS).length,
      Bob: bob.payloadsOf(EVENTS.GAME_DECK_STATUS).length,
    };
    // Release the suspended reads and drain: each start attempt re-reads the
    // library once more, so the gate has to be released as it fills again.
    for (let i = 0; i < 5; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      for (const release of deferred.splice(0)) release();
    }

    expect(session.isStarted).toBe(true);
    expect(harness.createGame).toHaveBeenCalledTimes(1);
    // One game-init per seat and no deck-status on a started session.
    expect(alice.payloadsOf(EVENTS.GAME_INIT)).toHaveLength(1);
    expect(bob.payloadsOf(EVENTS.GAME_INIT)).toHaveLength(1);
    expect(alice.payloadsOf(EVENTS.GAME_DECK_STATUS)).toHaveLength(statusCount.Alice);
    expect(bob.payloadsOf(EVENTS.GAME_DECK_STATUS)).toHaveLength(statusCount.Bob);
  });
});

describe("session-backed connections", () => {
  test("both seats connected without picks hold the selection phase; picks start the game", async () => {
    const { registry, createGame, alice, bob } = await makeStartedHarness();

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
    const { bob } = await makeStartedHarness();

    const bobInit = bob.lastPayloadOf(EVENTS.GAME_INIT);
    expect(bobInit.you.hand.length).toBeGreaterThan(0);
    for (const card of bobInit.opponent.hand) {
      expect(card).toEqual({});
    }
  });

  test("duplicate sockets on one seat share the session and both receive updates", async () => {
    const { registry, deckLibrary, connect } = makeHarness({ rooms: fullRoom() });
    const aliceTab1 = await connect({ roomCode: ROOM, username: "Alice" });
    const aliceTab2 = await connect({ roomCode: ROOM, username: "Alice" });
    const bob = await connect({ roomCode: ROOM, username: "Bob" });

    expect(registry.get(ROOM).connectionCount("Alice")).toBe(2);

    const aliceDeck = deckLibrary.createDeck({ owner: "Alice", name: "Alice's deck", cards: legalSlugs() });
    const bobDeck = deckLibrary.createDeck({ owner: "Bob", name: "Bob's deck", cards: legalSlugs() });
    await aliceTab1.trigger(EVENTS.GAME_DECK_SELECT, { deckId: aliceDeck.id });
    await bob.trigger(EVENTS.GAME_DECK_SELECT, { deckId: bobDeck.id });

    await aliceTab1.trigger(EVENTS.GAME_ACTION, passTurn);

    expect(aliceTab1.lastPayloadOf(EVENTS.GAME_UPDATE)).not.toBeNull();
    expect(aliceTab2.lastPayloadOf(EVENTS.GAME_UPDATE)).not.toBeNull();
  });

  test("reconnecting after a disconnect resumes the same session and game", async () => {
    const { registry, createdGames, createGame, connect } = await makeStartedHarness();

    const alice = registry.get(ROOM);
    expect(alice).not.toBeNull();
    // Reconnect through the harness's connection handler by attaching a new socket.
    const rejoined = await connect({ roomCode: ROOM, username: "Alice" });

    const init = rejoined.lastPayloadOf(EVENTS.GAME_INIT);
    expect(init).not.toBeNull();
    expect(init.you.username).toBe("Alice");
    expect(registry.get(ROOM).game).toBe(createdGames[0]);
    expect(createGame).toHaveBeenCalledTimes(1);
  });

  test("no session recreation when every player leaves", async () => {
    const { registry, createdGames, createGame, alice, bob } = await makeStartedHarness();

    await alice.trigger(TRANSPORT_EVENTS.DISCONNECT);
    await bob.trigger(TRANSPORT_EVENTS.DISCONNECT);

    expect(registry.size).toBe(1);
    expect(registry.get(ROOM).game).toBe(createdGames[0]);
    expect(registry.get(ROOM).isEmpty()).toBe(true);
    expect(createGame).toHaveBeenCalledTimes(1);
  });
});

describe("game-state-request", () => {
  test("answers with the current state view once the game is started", async () => {
    const { alice } = await makeStartedHarness();
    await alice.trigger(EVENTS.GAME_ACTION, passTurn);

    await alice.trigger(EVENTS.GAME_STATE_REQUEST);

    const view = alice.lastPayloadOf(EVENTS.GAME_INIT);
    expect(view.currentTurn).toBe("Bob");
    expect(view.round).toBe(1);
    expect(view.revision).toBe(2);
  });

  test("answers with game-waiting when no session exists yet", async () => {
    const { connect } = makeHarness({ rooms: loneRoom() });

    const alice = await connect({ roomCode: ROOM, username: "Alice" });
    await alice.trigger(EVENTS.GAME_STATE_REQUEST);

    expect(alice.lastPayloadOf(EVENTS.GAME_WAITING)).toEqual(buildWaitingPayload());
  });

  test("answers with the selection progress when the session is unstarted", async () => {
    const { registry, connect } = makeHarness({ rooms: fullRoom() });
    const alice = await connect({ roomCode: ROOM, username: "Alice" });

    await alice.trigger(EVENTS.GAME_STATE_REQUEST);

    const status = alice.lastPayloadOf(EVENTS.GAME_DECK_STATUS);
    expect(status).toEqual(
      buildDeckStatus({
        dev: false,
        seats: [
          { username: "Alice", deckChosen: false, deckId: null, deckName: null, illegal: false },
          { username: "Bob", deckChosen: false, deckId: null, deckName: null, illegal: false },
        ],
      })
    );
    expect(registry.get(ROOM).isStarted).toBe(false);
  });
});

describe("inbound action validation", () => {
  test.each([
    ["null payload", null],
    ["missing type", { data: {} }],
    ["empty type", { type: "", data: {} }],
    ["data is not an object", { type: "pass-turn-action", data: "nope" }],
  ])("rejects %s before the engine sees it", async (_label, action) => {
    const { alice, registry } = await makeStartedHarness();
    const session = registry.get(ROOM);
    const revisionBefore = session.revision;

    await alice.trigger(EVENTS.GAME_ACTION, action);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({ message: "Malformed action payload." });
    expect(session.revision).toBe(revisionBefore);
    expect(session.game.round).toBe(1);
  });

  test("an unknown action type is rejected by the engine and changes nothing", async () => {
    const { alice, registry } = await makeStartedHarness();
    const session = registry.get(ROOM);

    await alice.trigger(EVENTS.GAME_ACTION, { type: "nope-action", data: {} });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/invalid action type/);
    expect(session.revision).toBe(1);
    expect(session.game.currentTurn).toBe("Alice");
  });

  test("identity is stamped from the connection, not from the payload", async () => {
    const { alice, bob, registry } = await makeStartedHarness();
    const session = registry.get(ROOM);

    // Bob claims to be Alice; if the claim were trusted, the pass would succeed.
    await bob.trigger(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: { username: "Alice" } });

    expect(bob.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/not your turn/);
    expect(session.game.currentTurn).toBe("Alice");
    expect(alice.payloadsOf(EVENTS.GAME_UPDATE)).toHaveLength(0);
  });

  test("an accepted action broadcasts a bumped state view to every seat", async () => {
    const { alice, bob, registry } = await makeStartedHarness();

    await alice.trigger(EVENTS.GAME_ACTION, passTurn);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    const update = alice.lastPayloadOf(EVENTS.GAME_UPDATE);
    expect(update.revision).toBe(2);
    expect(update.currentTurn).toBe("Bob");
    expect(bob.lastPayloadOf(EVENTS.GAME_UPDATE).currentTurn).toBe("Bob");
  });
});

describe("inbound decision validation", () => {
  const makeHarnessWithDecision = async () => {
    const harness = await makeStartedHarness();
    const game = harness.createdGames[0];
    const decisionId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: 77, name: "Candidate", hp: 4 }],
      minChoices: 1,
      maxChoices: 1,
      resolve: () => {},
    });
    return { ...harness, decisionId };
  };

  test.each([
    ["null payload", null],
    ["missing decision id", { choices: [77] }],
    ["choices is not an array", { decisionId: "d1", choices: "77" }],
  ])("rejects %s before the engine sees it", async (_label, decision) => {
    const { alice, registry } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    await alice.trigger(EVENTS.GAME_DECISION, decision);

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toEqual({ message: "Malformed decision payload." });
    expect(session.game.pendingDecision).not.toBeNull();
  });

  test("a wrong decision id is rejected and leaves the decision open", async () => {
    const { alice, registry } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    await alice.trigger(EVENTS.GAME_DECISION, { decisionId: "nope", choices: [77] });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/Decision ID does not match/);
    expect(session.game.pendingDecision).not.toBeNull();
    expect(session.revision).toBe(1);
  });

  test("a valid decision resolves and broadcasts the update", async () => {
    const { alice, bob, registry, decisionId } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    await alice.trigger(EVENTS.GAME_DECISION, { decisionId, choices: [77] });

    expect(alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    expect(session.game.pendingDecision).toBeNull();
    expect(session.revision).toBe(2);
    expect(alice.lastPayloadOf(EVENTS.GAME_UPDATE).revision).toBe(2);
    expect(bob.lastPayloadOf(EVENTS.GAME_UPDATE).revision).toBe(2);
  });

  test("only the decision owner may resolve it", async () => {
    const { bob, registry } = await makeHarnessWithDecision();
    const session = registry.get(ROOM);

    await bob.trigger(EVENTS.GAME_DECISION, { decisionId: session.game.pendingDecision.decisionId, choices: [77] });

    expect(bob.lastPayloadOf(EVENTS.GAME_ERROR).message).toMatch(/Only the decision owner/);
    expect(session.game.pendingDecision).not.toBeNull();
  });
});

describe("game over", () => {
  const makeEndedGameHarness = async () => {
    const harness = await makeStartedHarness();
    const game = harness.createdGames[0];
    game.playerStates.Alice.deck = [];
    harness.alice.trigger(EVENTS.GAME_ACTION, passTurn);
    harness.bob.trigger(EVENTS.GAME_ACTION, passTurn);
    return harness;
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

    await alice.trigger(EVENTS.GAME_ACTION, passTurn);

    expect(alice.lastPayloadOf(EVENTS.GAME_OVER)).toEqual({ winner: "Bob", reason: "deck exhausted" });
    expect(alice.payloadsOf(EVENTS.GAME_ERROR)).toHaveLength(0);
    expect(session.revision).toBe(revision);
  });
});
