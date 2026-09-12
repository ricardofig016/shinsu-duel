import { jest } from "@jest/globals";
import GameSession from "../../net/GameSession.js";
import { createTestGame } from "../utils.js";

const ROOM_CODE = "ROOM1";
const USERNAMES = ["Alice", "Bob"];

const makeConnection = () => ({
  sent: [],
  send(event, payload) {
    this.sent.push({ event, payload });
  },
});

const makeSession = ({ game = null, createGame } = {}) =>
  new GameSession({
    roomCode: ROOM_CODE,
    usernames: USERNAMES,
    seed: 42,
    createGame: createGame ?? (() => game ?? createTestGame()),
  });

describe("GameSession construction", () => {
  test("holds its room, seats, seed, and an unstarted game at revision 0", () => {
    const session = makeSession();

    expect(session.roomCode).toBe(ROOM_CODE);
    expect(session.usernames).toEqual(USERNAMES);
    expect(session.seed).toBe(42);
    expect(session.game).toBeNull();
    expect(session.isStarted).toBe(false);
    expect(session.revision).toBe(0);
    expect(session.hasSeat("Alice")).toBe(true);
    expect(session.hasSeat("Bob")).toBe(true);
    expect(session.hasSeat("Mallory")).toBe(false);
  });

  test.each([
    ["empty room code", { roomCode: "" }],
    ["one username", { usernames: ["Alice"] }],
    ["three usernames", { usernames: ["Alice", "Bob", "Mallory"] }],
    ["duplicate usernames", { usernames: ["Alice", "Alice"] }],
    ["non-numeric seed", { seed: "42" }],
    ["non-function createGame", { createGame: "nope" }],
  ])("rejects %s", (_label, override) => {
    expect(
      () =>
        new GameSession({
          roomCode: ROOM_CODE,
          usernames: USERNAMES,
          seed: 42,
          createGame: () => createTestGame(),
          ...override,
        })
    ).toThrow(TypeError);
  });
});

describe("GameSession seats", () => {
  test("tracks multiple connections per seat and fullness", () => {
    const session = makeSession();
    const alice1 = makeConnection();
    const alice2 = makeConnection();
    const bob1 = makeConnection();

    session.attach("Alice", alice1);
    expect(session.connectionCount("Alice")).toBe(1);
    expect(session.isFull()).toBe(false);

    session.attach("Bob", bob1);
    expect(session.isFull()).toBe(true);

    session.attach("Alice", alice2);
    expect(session.connectionCount("Alice")).toBe(2);
    expect(session.connectionCount("Bob")).toBe(1);
  });

  test("detach removes one connection and is idempotent", () => {
    const session = makeSession();
    const alice1 = makeConnection();
    const alice2 = makeConnection();
    session.attach("Alice", alice1);
    session.attach("Alice", alice2);

    session.detach("Alice", alice1);
    expect(session.connectionCount("Alice")).toBe(1);

    session.detach("Alice", alice1);
    session.detach("Mallory", alice1);
    expect(session.connectionCount("Alice")).toBe(1);

    session.detach("Alice", alice2);
    expect(session.isEmpty()).toBe(true);
  });

  test("rejects attaching to an unknown seat or with a non-connection object", () => {
    const session = makeSession();

    expect(() => session.attach("Mallory", makeConnection())).toThrow(/no seat for Mallory/);
    expect(() => session.attach("Alice", { noSend: true })).toThrow(TypeError);
    expect(() => session.attach("Alice", null)).toThrow(TypeError);
  });
});

describe("GameSession game lifecycle", () => {
  test("ensureGame creates the game once and counts creation as the first revision", () => {
    const createGame = jest.fn(() => createTestGame());
    const session = makeSession({ createGame });

    const game = session.ensureGame();
    expect(session.isStarted).toBe(true);
    expect(session.game).toBe(game);
    expect(session.revision).toBe(1);
    expect(createGame).toHaveBeenCalledTimes(1);
    expect(createGame).toHaveBeenCalledWith({ roomCode: ROOM_CODE, usernames: USERNAMES, seed: 42, decks: null, enforceDeckRules: true });

    expect(session.ensureGame()).toBe(game);
    expect(createGame).toHaveBeenCalledTimes(1);
    expect(session.revision).toBe(1);
  });

  test("ensureGame rejects a factory product without the engine contract", () => {
    const session = makeSession({ createGame: () => ({ nope: true }) });
    expect(() => session.ensureGame()).toThrow(TypeError);
    expect(session.isStarted).toBe(false);
  });

  test("applyAction delegates to the engine and bumps the revision on success only", () => {
    const game = createTestGame();
    const session = makeSession({ game });
    session.ensureGame();
    expect(game.currentTurn).toBe("Alice");

    const revisionBefore = session.revision;
    expect(
      session.applyAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } })
    ).toBe(revisionBefore + 1);
    expect(game.currentTurn).toBe("Bob");

    expect(() =>
      session.applyAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } })
    ).toThrow(/not your turn/);
    expect(session.revision).toBe(revisionBefore + 1);
  });

  test("applyDecision delegates to the engine and bumps the revision on success only", () => {
    const game = createTestGame();
    const session = makeSession({ game });
    session.ensureGame();

    const onResolve = jest.fn();
    const decisionId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: 77, name: "Candidate", hp: 4 }],
      minChoices: 1,
      maxChoices: 1,
      resolve: onResolve,
    });

    const revisionBefore = session.revision;
    expect(session.applyDecision({ decisionId, choices: [77], username: "Alice" })).toBe(
      revisionBefore + 1
    );
    expect(onResolve).toHaveBeenCalledWith([77]);

    const rejectedId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: 78, name: "Candidate", hp: 4 }],
      minChoices: 1,
      maxChoices: 1,
      resolve: () => {},
    });
    expect(() => session.applyDecision({ decisionId: "nope", choices: [78], username: "Alice" })).toThrow(
      /Decision ID does not match/
    );
    expect(session.revision).toBe(revisionBefore + 1);
    expect(game.pendingDecision.decisionId).toBe(rejectedId);
  });

  test("actions and decisions are rejected before the game started", () => {
    const session = makeSession();

    expect(() => session.applyAction({ type: "pass-turn-action", data: {} })).toThrow(
      /has not started yet/
    );
    expect(() => session.applyDecision({ decisionId: "d1", choices: [] })).toThrow(
      /has not started yet/
    );
  });
});

describe("GameSession deck picks", () => {
  const pick = (over = {}) => ({ deckId: "deck-1", name: "Deck", cards: ["slug_a", "slug_b"], illegal: false, ...over });

  test("stores, replaces, and reads a seat's pick", () => {
    const session = makeSession();

    expect(session.getDeckPick("Alice")).toBeNull();

    session.setDeckPick("Alice", pick());
    session.setDeckPick("Alice", pick({ deckId: "deck-2", name: "Other" }));

    expect(session.getDeckPick("Alice")).toEqual({
      deckId: "deck-2",
      name: "Other",
      cards: ["slug_a", "slug_b"],
      illegal: false,
    });
    expect(session.getDeckPick("Bob")).toBeNull();
  });

  test("the stored pick is a copy of the given record", () => {
    const session = makeSession();
    const given = pick();

    session.setDeckPick("Alice", given);
    given.cards.push("slug_c");
    given.name = "tampered";

    expect(session.getDeckPick("Alice").cards).toEqual(["slug_a", "slug_b"]);
    expect(session.getDeckPick("Alice").name).toBe("Deck");
  });

  test("rejects picks for unknown seats and malformed records", () => {
    const session = makeSession();

    expect(() => session.setDeckPick("Mallory", pick())).toThrow(/no seat/);
    expect(() => session.setDeckPick("Alice", null)).toThrow(TypeError);
    expect(() => session.setDeckPick("Alice", pick({ deckId: "" }))).toThrow(TypeError);
    expect(() => session.setDeckPick("Alice", pick({ name: "" }))).toThrow(TypeError);
    expect(() => session.setDeckPick("Alice", pick({ cards: "slug_a" }))).toThrow(TypeError);
    expect(() => session.setDeckPick("Alice", pick({ cards: [7] }))).toThrow(TypeError);
    expect(() => session.setDeckPick("Alice", pick({ illegal: "yes" }))).toThrow(TypeError);
  });

  test("clearing one pick leaves the other; clearing all empties the phase", () => {
    const session = makeSession();
    session.setDeckPick("Alice", pick());
    session.setDeckPick("Bob", pick({ deckId: "deck-2" }));

    session.clearDeckPick("Alice");
    expect(session.getDeckPick("Alice")).toBeNull();
    expect(session.getDeckPick("Bob")).not.toBeNull();

    session.clearDeckPicks();
    expect(session.getDeckPick("Bob")).toBeNull();
  });

  test("ensureGame forwards the start arguments to the factory", () => {
    const createGame = jest.fn(() => createTestGame());
    const session = makeSession({ createGame });
    const decks = { Alice: [1, 2, 3], Bob: [4, 5, 6] };

    session.ensureGame({ decks, enforceDeckRules: false });

    expect(createGame).toHaveBeenCalledWith({
      roomCode: ROOM_CODE,
      usernames: USERNAMES,
      seed: 42,
      decks,
      enforceDeckRules: false,
    });
  });
});

describe("GameSession delivery", () => {
  test("broadcast builds one payload per seat and sends it to every connection of the seat", () => {
    const session = makeSession();
    const alice1 = makeConnection();
    const alice2 = makeConnection();
    const bob1 = makeConnection();
    session.attach("Alice", alice1);
    session.attach("Alice", alice2);
    session.attach("Bob", bob1);

    const buildPayload = jest.fn((username) => ({ for: username }));
    session.broadcast("game-update", buildPayload);

    expect(buildPayload).toHaveBeenCalledTimes(2);
    expect(buildPayload).toHaveBeenNthCalledWith(1, "Alice");
    expect(buildPayload).toHaveBeenNthCalledWith(2, "Bob");
    expect(alice1.sent).toEqual([{ event: "game-update", payload: { for: "Alice" } }]);
    expect(alice2.sent).toEqual([{ event: "game-update", payload: { for: "Alice" } }]);
    expect(bob1.sent).toEqual([{ event: "game-update", payload: { for: "Bob" } }]);
  });

  test("broadcast and sendTo require a payload builder; sendTo reaches one seat only", () => {
    const session = makeSession();
    const alice1 = makeConnection();
    const bob1 = makeConnection();
    session.attach("Alice", alice1);
    session.attach("Bob", bob1);

    expect(() => session.broadcast("game-update", "not-a-function")).toThrow(TypeError);
    expect(() => session.sendTo("Alice", "game-update")).toThrow(TypeError);
    expect(() => session.sendTo("Mallory", "game-update", () => ({}))).toThrow(/no seat for Mallory/);

    session.sendTo("Alice", "game-hand-peek", (username) => ({ to: username }));
    expect(alice1.sent).toEqual([{ event: "game-hand-peek", payload: { to: "Alice" } }]);
    expect(bob1.sent).toEqual([]);
  });
});
