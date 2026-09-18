import { jest } from "@jest/globals";
import {
  EVENTS,
  ERROR_CODES,
  buildStateView,
  buildError,
  buildGameOverResult,
  buildWaitingPayload,
  buildHandPeek,
  buildDeckSelect,
  buildDeckStatus,
  buildDeckReveal,
  buildDebugEvent,
  buildDebugResult,
} from "../../net/protocol.js";
import { advanceToRound, createTestGame, setupGameWithHands, deployUnit } from "../utils.js";

describe("protocol event names", () => {
  test("covers the inbound and outbound contract", () => {
    expect(EVENTS.GAME_ACTION).toBe("game-action");
    expect(EVENTS.GAME_DECISION).toBe("game-decision");
    expect(EVENTS.GAME_STATE_REQUEST).toBe("game-state-request");
    expect(EVENTS.GAME_DECK_SELECT).toBe("game-deck-select");
    expect(EVENTS.GAME_DEBUG_ACTION).toBe("debug-action");
    expect(EVENTS.GAME_DEBUG_QUERY).toBe("debug-query");
    expect(EVENTS.GAME_DEBUG_FIREHOSE).toBe("debug-firehose");
    expect(EVENTS.GAME_DEBUG_RESTART).toBe("debug-restart");
    expect(EVENTS.GAME_INIT).toBe("game-init");
    expect(EVENTS.GAME_UPDATE).toBe("game-update");
    expect(EVENTS.GAME_ERROR).toBe("game-error");
    expect(EVENTS.GAME_OVER).toBe("game-over");
    expect(EVENTS.GAME_WAITING).toBe("game-waiting");
    expect(EVENTS.GAME_HAND_PEEK).toBe("game-hand-peek");
    expect(EVENTS.GAME_DECK_STATUS).toBe("game-deck-status");
    expect(EVENTS.GAME_DECK_REVEAL).toBe("game-deck-reveal");
    expect(EVENTS.GAME_DEBUG_RESULT).toBe("debug-result");
    expect(EVENTS.GAME_DEBUG_EVENT).toBe("debug-event");
  });

  test("every event name is a unique non-empty string", () => {
    const names = Object.values(EVENTS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      expect(typeof name).toBe("string");
      expect(name.trim()).not.toBe("");
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("buildStateView", () => {
  test("wraps the per-username client state with the session revision", () => {
    const game = createTestGame();
    const view = buildStateView({ game, revision: 1, username: game.currentTurn });

    expect(view.revision).toBe(1);
    expect(view.round).toBe(game.round);
    expect(view.currentTurn).toBe(game.currentTurn);
    expect(view.gameOver).toBeNull();
    expect(view.you.username).toBe(game.currentTurn);
    expect(view.opponent.username).not.toBe(game.currentTurn);
  });

  test("hides the opponent's hand cards", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Shinheuh"] });
    const view = buildStateView({ game, revision: 1, username: "Alice" });

    expect(view.opponent.hand).toHaveLength(game.playerStates.Bob.hand.length);
    for (const card of view.opponent.hand) {
      expect(card).toEqual({});
    }
    expect(view.you.hand.length).toBeGreaterThan(0);
    expect(view.you.hand[0]).toHaveProperty("name");
  });

  test("exposes the pending decision to its owner only", () => {
    const game = createTestGame();
    const decisionId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: 77, name: "Candidate", hp: 4 }],
      minChoices: 1,
      maxChoices: 1,
      resolve: () => {},
    });

    const ownerView = buildStateView({ game, revision: 2, username: "Alice" });
    expect(ownerView.you.pendingDecision).toMatchObject({
      decisionId,
      type: "target_selection",
      minChoices: 1,
      maxChoices: 1,
    });
    expect(ownerView.you.pendingDecision.candidates).toEqual([
      expect.objectContaining({ id: 77, name: "Candidate", hp: 4 }),
    ]);

    const opponentView = buildStateView({ game, revision: 2, username: "Bob" });
    expect(opponentView.you.pendingDecision).toBeNull();
    expect(opponentView.opponent).not.toHaveProperty("pendingDecision");
  });

  test("carries the current round", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    advanceToRound(game, 3);

    expect(buildStateView({ game, revision: 1, username: "Alice" }).round).toBe(3);
  });

  test("reflects deployed unit conditions with magnitudes", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "scout");
    game.modifierStack.apply({
      sourceId: unit.id,
      sourceType: "unit",
      targetId: unit.id,
      type: "condition",
      key: "poisoned",
      value: 2,
      operation: "add",
    });

    const view = buildStateView({ game, revision: 1, username: "Alice" });
    const projected = view.you.field.frontline.find((u) => u.id === unit.id);
    expect(projected.conditions).toEqual([
      {
        key: "poisoned",
        magnitude: 2,
        name: "Poisoned",
        description: { segments: ["I take x damage when I use an ", { type: "rule", ref: "ability", text: "Ability" }] },
        iconPath: "/assets/icons/conditions/poisoned.png",
      },
    ]);
  });

  test("rejects malformed arguments", () => {
    const game = createTestGame();
    expect(() => buildStateView({ revision: 1, username: "Alice" })).toThrow(TypeError);
    expect(() => buildStateView({ game, revision: -1, username: "Alice" })).toThrow(TypeError);
    expect(() => buildStateView({ game, revision: 1.5, username: "Alice" })).toThrow(TypeError);
    expect(() => buildStateView({ game, revision: 1, username: "" })).toThrow(TypeError);
  });
});

describe("payload builders", () => {
  test("buildError returns the exact error payload", () => {
    expect(buildError("Not your turn.")).toEqual({ message: "Not your turn." });
    expect(() => buildError("")).toThrow(TypeError);
    expect(() => buildError(null)).toThrow(TypeError);
  });

  test("buildError carries a known code and omits the field otherwise", () => {
    expect(buildError("Session ended.", ERROR_CODES.UNAUTHENTICATED)).toEqual({
      message: "Session ended.",
      code: "unauthenticated",
    });
    expect(buildError("Not your turn.")).not.toHaveProperty("code");
    expect(() => buildError("Not your turn.", "made-up")).toThrow(TypeError);
  });

  test("buildError names the query a refusal answers, and nothing else", () => {
    // A dev-console query is refused with its own request id, so the console
    // settles that query and leaves the others in flight.
    expect(buildError("Unit u1 is not on the field.", null, "q7")).toEqual({
      message: "Unit u1 is not on the field.",
      requestId: "q7",
    });
    expect(buildError("Not your turn.")).not.toHaveProperty("requestId");
    expect(() => buildError("Not your turn.", null, "")).toThrow(TypeError);
  });

  test("buildGameOverResult returns only winner and reason", () => {
    expect(buildGameOverResult({ winner: "Alice", reason: "deck exhausted" })).toEqual({
      winner: "Alice",
      reason: "deck exhausted",
    });
    expect(buildGameOverResult({ winner: "Alice", reason: "deck exhausted", internal: true })).toEqual({
      winner: "Alice",
      reason: "deck exhausted",
    });
    expect(() => buildGameOverResult(null)).toThrow(TypeError);
    expect(() => buildGameOverResult({ winner: "", reason: "x" })).toThrow(TypeError);
  });

  test("buildWaitingPayload returns the exact waiting payload", () => {
    expect(buildWaitingPayload()).toEqual({ message: "Waiting for the other player to join." });
  });

  test("buildHandPeek returns an independent copy of the reveal", () => {
    const peek = {
      owner: "Bob",
      observer: "Alice",
      cards: [{ id: 5, name: "Test Shinheuh", cost: 2, type: "unit" }],
    };
    const payload = buildHandPeek(peek);

    expect(payload).toEqual(peek);
    expect(payload.cards[0]).not.toBe(peek.cards[0]);

    peek.cards[0].name = "tampered";
    expect(payload.cards[0].name).toBe("Test Shinheuh");
  });

  test("buildHandPeek rejects malformed reveals", () => {
    expect(() => buildHandPeek(null)).toThrow(TypeError);
    expect(() => buildHandPeek({ owner: "Bob", observer: "", cards: [] })).toThrow(TypeError);
    expect(() => buildHandPeek({ owner: "Bob", observer: "Alice" })).toThrow(TypeError);
  });

  test("buildDeckSelect returns the exact payload", () => {
    expect(buildDeckSelect({ deckId: "deck-abc" })).toEqual({ deckId: "deck-abc" });
    expect(() => buildDeckSelect({ deckId: "" })).toThrow(TypeError);
    expect(() => buildDeckSelect({ deckId: null })).toThrow(TypeError);
    expect(() => buildDeckSelect({})).toThrow(TypeError);
  });

  test("buildDeckStatus returns the exact per-seat progress, redacted for every viewer", () => {
    const seats = [
      { username: "Alice", deckChosen: true, connected: true, bot: false, deckId: "deck-1", deckName: "Starter", illegal: true },
      { username: "Bob", deckChosen: false, connected: false, bot: false, deckId: null, deckName: null, illegal: false },
    ];

    const ownView = buildDeckStatus({ dev: false, viewer: "Alice", seats });

    expect(ownView).toEqual({
      dev: false,
      seats: [
        { username: "Alice", deckChosen: true, connected: true, bot: false, deckId: "deck-1", deckName: "Starter", illegal: true },
        { username: "Bob", deckChosen: false, connected: false, bot: false, deckId: null, deckName: null, illegal: false },
      ],
    });
    expect(ownView.seats[0]).not.toBe(seats[0]);

    // The other seat's pick is visible as a fact, never as an identity: a seat
    // that could read the opponent's deck could counter-pick it.
    expect(buildDeckStatus({ dev: false, viewer: "Bob", seats }).seats).toEqual([
      { username: "Alice", deckChosen: true, connected: true, bot: false, deckId: null, deckName: null, illegal: false },
      { username: "Bob", deckChosen: false, connected: false, bot: false, deckId: null, deckName: null, illegal: false },
    ]);
  });

  test("buildDeckReveal copies each seat's name and fan in seat order", () => {
    const seats = [
      { username: "Alice", deckName: "Starter", fan: ["test_filler_3", "test_filler_7"] },
      { username: "Bob", deckName: "Plain deck", fan: [] },
    ];
    const payload = buildDeckReveal({ seats });

    // The payload carries the fan alone: a deck's full card list never goes
    // out on the reveal.
    expect(payload).toEqual({
      seats: [
        { username: "Alice", deckName: "Starter", fan: ["test_filler_3", "test_filler_7"] },
        { username: "Bob", deckName: "Plain deck", fan: [] },
      ],
    });
    expect(payload.seats[0]).not.toBe(seats[0]);
    expect(payload.seats[0].fan).not.toBe(seats[0].fan);

    expect(() => buildDeckReveal({ seats: [] })).toThrow(TypeError);
    expect(() => buildDeckReveal({ seats: null })).toThrow(TypeError);
    expect(() => buildDeckReveal({ seats: [{ username: "", deckName: "Starter", fan: [] }] })).toThrow(TypeError);
    expect(() => buildDeckReveal({ seats: [{ username: "Alice", deckName: "", fan: [] }] })).toThrow(TypeError);
    expect(() => buildDeckReveal({ seats: [{ username: "Alice", deckName: "Starter", fan: "slug" }] })).toThrow(TypeError);
    expect(() => buildDeckReveal({ seats: [{ username: "Alice", deckName: "Starter", fan: [""] }] })).toThrow(TypeError);
  });

  test("buildDeckStatus rejects malformed progress", () => {
    const seat = { username: "Alice", deckChosen: true, connected: true, bot: false, deckId: "deck-1", deckName: "Starter", illegal: false };
    expect(() => buildDeckStatus({ dev: "yes", viewer: "Alice", seats: [seat] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: null })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [{ ...seat, username: "" }] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [{ ...seat, deckChosen: null }] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [{ ...seat, connected: null }] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [{ ...seat, deckName: null }] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [{ ...seat, deckId: null }] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "Alice", seats: [{ ...seat, illegal: 1 }] })).toThrow(TypeError);
    expect(() =>
      buildDeckStatus({
        dev: false,
        viewer: "Alice",
        seats: [{ username: "Bob", deckChosen: false, connected: true, bot: false, deckId: null, deckName: "X", illegal: false }],
      })
    ).toThrow(TypeError);
    // The viewer's own seat has to be among the entries, and the viewer itself
    // is not optional.
    expect(() =>
      buildDeckStatus({
        dev: false,
        viewer: "Alice",
        seats: [{ username: "Bob", deckChosen: false, connected: true, bot: false, deckId: null, deckName: null, illegal: false }],
      })
    ).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, seats: [seat] })).toThrow(TypeError);
    expect(() => buildDeckStatus({ dev: false, viewer: "", seats: [seat] })).toThrow(TypeError);
  });

  test("buildDebugResult echoes the request and carries the query's data", () => {
    const data = { username: "Alice", cards: [{ cardId: 7, instanceId: "Card#7#1", name: "Test Scout" }] };
    expect(buildDebugResult({ requestId: "q1", kind: "hand", data })).toEqual({
      requestId: "q1",
      kind: "hand",
      data,
    });
    expect(() => buildDebugResult({ requestId: "", kind: "hand", data })).toThrow(TypeError);
    expect(() => buildDebugResult({ requestId: "q1", kind: "", data })).toThrow(TypeError);
    expect(() => buildDebugResult({ requestId: "q1", kind: "hand", data: null })).toThrow(TypeError);
  });

  test("buildDebugEvent projects the root event's scalar payload fields", () => {
    const unit = { id: "unit-1", card: { name: "Test Scout" } };
    const line = buildDebugEvent({
      sequence: 3,
      eventName: "unit:deployed",
      payload: {
        username: "Alice",
        unitId: "unit-1",
        unit,
        tags: ["a", "b"],
        nested: [{ id: "x" }],
        count: 2,
        quick: false,
        nothing: null,
        playerStates: { Alice: {} },
      },
    });

    expect(line).toEqual({
      sequence: 3,
      name: "unit:deployed",
      fields: {
        username: "Alice",
        unitId: "unit-1",
        tags: ["a", "b"],
        count: 2,
        quick: false,
        nothing: null,
      },
    });
    // Live engine objects alias game state, so they never reach the wire.
    expect(line.fields).not.toHaveProperty("unit");
    expect(line.fields).not.toHaveProperty("playerStates");
  });

  test("buildDebugEvent rejects a bad sequence or an empty name, and survives odd payloads", () => {
    expect(() => buildDebugEvent({ sequence: 0, eventName: "x", payload: {} })).toThrow(TypeError);
    expect(() => buildDebugEvent({ sequence: 1.5, eventName: "x", payload: {} })).toThrow(TypeError);
    expect(() => buildDebugEvent({ sequence: 1, eventName: "", payload: {} })).toThrow(TypeError);
    expect(buildDebugEvent({ sequence: 1, eventName: "turn:started", payload: null }).fields).toEqual({});
    expect(buildDebugEvent({ sequence: 2, eventName: "turn:started", payload: 7 }).fields).toEqual({});
  });
});
