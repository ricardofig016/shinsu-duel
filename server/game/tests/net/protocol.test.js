import { jest } from "@jest/globals";
import {
  EVENTS,
  buildStateView,
  buildError,
  buildGameOverResult,
  buildWaitingPayload,
  buildHandPeek,
} from "../../net/protocol.js";
import { advanceToRound, createTestGame, setupGameWithHands, deployUnit } from "../utils.js";

describe("protocol event names", () => {
  test("covers the inbound and outbound contract", () => {
    expect(EVENTS.GAME_ACTION).toBe("game-action");
    expect(EVENTS.GAME_DECISION).toBe("game-decision");
    expect(EVENTS.GAME_STATE_REQUEST).toBe("game-state-request");
    expect(EVENTS.GAME_INIT).toBe("game-init");
    expect(EVENTS.GAME_UPDATE).toBe("game-update");
    expect(EVENTS.GAME_ERROR).toBe("game-error");
    expect(EVENTS.GAME_OVER).toBe("game-over");
    expect(EVENTS.GAME_WAITING).toBe("game-waiting");
    expect(EVENTS.GAME_HAND_PEEK).toBe("game-hand-peek");
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
        description: "I take x damage when I use an ability",
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
});
