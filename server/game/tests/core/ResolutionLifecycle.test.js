/**
 * Resolution Lifecycle State Tests
 *
 * Verifies the explicit lifecycle state model for pending decisions:
 *  - ResolutionState transitions (IDLE ⇄ RESOLVING)
 *  - Resolution depth tracking and cap
 *  - Re-entrancy guard on resolveDecision
 *  - Nested decision stacking (LIFO)
 *  - Continuation chains across resolution boundaries
 */

import GameState, { ResolutionState } from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck } from "../utils.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1) });
}

describe("Resolution lifecycle state model", () => {
  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  test("starts in IDLE state", () => {
    const game = createGame();
    expect(game._resolutionState).toBe(ResolutionState.IDLE);
    expect(game._resolutionDepth).toBe(0);
    expect(game.hasUnresolvedDecisions()).toBe(false);
  });

  test("transitions IDLE → RESOLVING on createPendingDecision", () => {
    const game = createGame();
    game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "U1", name: "Target", hp: 3 }],
      resolve: () => {},
    });
    expect(game._resolutionState).toBe(ResolutionState.RESOLVING);
    expect(game._resolutionDepth).toBe(1);
    expect(game.hasUnresolvedDecisions()).toBe(true);
  });

  test("transitions RESOLVING → IDLE after last decision resolved", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "U1", name: "Target", hp: 3 }],
      resolve: () => {},
    });
    game.resolveDecision({ decisionId: id, choices: ["U1"] });
    expect(game._resolutionState).toBe(ResolutionState.IDLE);
    expect(game._resolutionDepth).toBe(0);
    expect(game.hasUnresolvedDecisions()).toBe(false);
  });

  test("stays RESOLVING after resolving one of multiple stacked decisions", () => {
    const game = createGame();
    game.createPendingDecision({
      owner: "Alice", type: "line_overflow",
      candidates: [{ id: "U1", name: "A", hp: 3 }, { id: "U2", name: "B", hp: 5 }],
      resolve: () => {},
    });
    const topId = game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U3", name: "C", hp: 2 }],
      resolve: () => {},
    });

    expect(game._resolutionDepth).toBe(2);

    game.resolveDecision({ decisionId: topId, choices: ["U3"] });

    expect(game._resolutionState).toBe(ResolutionState.RESOLVING);
    expect(game._resolutionDepth).toBe(1);
    expect(game.hasUnresolvedDecisions()).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Depth limit
  // -----------------------------------------------------------------------

  test("createPendingDecision enforces MAX_RESOLUTION_DEPTH", () => {
    const game = createGame();
    // Push 16 nested decisions
    for (let i = 0; i < 16; i++) {
      game.createPendingDecision({
        owner: "Alice", type: "target_selection",
        candidates: [{ id: `U${i}`, name: `Target${i}`, hp: 1 }],
        resolve: () => {},
      });
    }
    expect(game._resolutionDepth).toBe(16);

    // 17th should throw
    expect(() => game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U17", name: "TooMany", hp: 1 }],
      resolve: () => {},
    })).toThrow(/Maximum nested pending decision depth/);
  });

  test("depth correctly decrements when resolving through deep stack", () => {
    const game = createGame();
    const ids = [];
    for (let i = 0; i < 5; i++) {
      ids.push(game.createPendingDecision({
        owner: "Alice", type: "target_selection",
        candidates: [{ id: `U${i}`, name: `T${i}`, hp: 1 }],
        resolve: () => {},
      }));
    }
    expect(game._resolutionDepth).toBe(5);

    // Resolve all in LIFO order
    for (let i = 4; i >= 0; i--) {
      game.resolveDecision({ decisionId: ids[i], choices: [`U${i}`] });
      expect(game._resolutionDepth).toBe(i);
    }

    expect(game._resolutionState).toBe(ResolutionState.IDLE);
    expect(game._resolutionDepth).toBe(0);
  });

  // -----------------------------------------------------------------------
  // Re-entrancy guard
  // -----------------------------------------------------------------------

  test("resolveDecision rejects re-entrant calls from within resolve callback", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {
        // Attempting to resolve another decision from inside the
        // resolution callback should fail.
        expect(() => game.resolveDecision({ decisionId: id, choices: ["U1"] }))
          .toThrow(/Cannot resolve a decision from within a resolution callback/);
      },
    });
    game.resolveDecision({ decisionId: id, choices: ["U1"] });
  });

  test("resolveDecision rejects re-entrant calls from within onResolved continuation", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {},
    });
    game.appendPendingDecisionContinuation(() => {
      expect(() => game.resolveDecision({ decisionId: id, choices: ["U1"] }))
        .toThrow(/Cannot resolve a decision from within a resolution callback/);
    });
    expect(() => game.resolveDecision({ decisionId: id, choices: ["U1"] }))
      .toThrow(/Cannot resolve a decision from within a resolution callback/);
  });

  test("nested createPendingDecision is allowed from within resolve callback", () => {
    const game = createGame();
    let nestedId = null;
    game.createPendingDecision({
      owner: "Alice", type: "line_overflow",
      candidates: [{ id: "U1", name: "A", hp: 3 }, { id: "U2", name: "B", hp: 5 }],
      resolve: () => {
        // Creating a new decision inside a resolve callback is legitimate
        // (e.g., overflow destroy triggers a target selection effect).
        nestedId = game.createPendingDecision({
          owner: "Alice", type: "target_selection",
          candidates: [{ id: "U3", name: "C", hp: 2 }],
          resolve: () => {},
        });
      },
    });

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["U1"] });

    expect(nestedId).not.toBeNull();
    // The active decision is now the one created inside the resolve callback.
    // Compare string values rather than object identity since IDs are sequential.
    expect(game.pendingDecision).not.toBeNull();
    expect(game.pendingDecision.decisionId).toBe(String(nestedId));
    expect(game._resolutionDepth).toBe(1); // outer drained, nested is current

    game.resolveDecision({ decisionId: nestedId, choices: ["U3"] });
    expect(game._resolutionState).toBe(ResolutionState.IDLE);
  });

  // -----------------------------------------------------------------------
  // processAction guard
  // -----------------------------------------------------------------------

  test("processAction is blocked during RESOLVING state", () => {
    const game = createGame();
    game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {},
    });
    expect(() => game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: "Alice" },
    })).toThrow(/decision must be resolved/);
  });

  test("processAction is unblocked after resolution completes", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {},
    });
    game.resolveDecision({ decisionId: id, choices: ["U1"] });

    // Should not throw now
    expect(() => game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: game.currentTurn },
    })).not.toThrow();
  });

  test("processAction blocked while stacked decision remains", () => {
    const game = createGame();
    game.createPendingDecision({
      owner: "Alice", type: "line_overflow",
      candidates: [{ id: "U1", name: "A", hp: 3 }, { id: "U2", name: "B", hp: 5 }],
      resolve: () => {},
    });
    const topId = game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U3", name: "C", hp: 2 }],
      resolve: () => {},
    });
    game.resolveDecision({ decisionId: topId, choices: ["U3"] });

    // Still blocked — stacked decision remains
    expect(() => game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: "Alice" },
    })).toThrow(/decision must be resolved/);
  });

  // -----------------------------------------------------------------------
  // Continuation chains
  // -----------------------------------------------------------------------

  test("continuations fire after resolution callback but during cleanup", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {},
    });
    let stateInContinuation = null;
    game.appendPendingDecisionContinuation(() => {
      stateInContinuation = game._resolutionState;
    });

    game.resolveDecision({ decisionId: id, choices: ["U1"] });

    // Continuations fire after the decision stack is drained. The state
    // transitions to IDLE before continuations execute so they see a
    // clean state.
    expect(stateInContinuation).toBe(ResolutionState.IDLE);
    expect(game._resolutionState).toBe(ResolutionState.IDLE);
  });

  test("multiple continuations execute in FIFO order", () => {
    const game = createGame();
    const order = [];
    const id = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {},
    });
    game.appendPendingDecisionContinuation(() => order.push("first"));
    game.appendPendingDecisionContinuation(() => order.push("second"));
    game.appendPendingDecisionContinuation(() => order.push("third"));

    game.resolveDecision({ decisionId: id, choices: ["U1"] });

    expect(order).toEqual(["first", "second", "third"]);
  });

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------

  test("resolveDecision throws when called in IDLE state", () => {
    const game = createGame();
    expect(game._resolutionState).toBe(ResolutionState.IDLE);
    expect(() => game.resolveDecision({ decisionId: "none", choices: ["x"] }))
      .toThrow(/no pending decision/);
  });

  test("resolutionDepth never goes below zero", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => {},
    });
    game.resolveDecision({ decisionId: id, choices: ["U1"] });
    expect(game._resolutionDepth).toBe(0);

    // Resolving again (which throws) shouldn't affect depth
    // because the guard checks _pendingDecision first
    expect(game._resolutionDepth).toBe(0);
  });

  test("state consistency after error in resolve callback", () => {
    const game = createGame();
    const id = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "U1", name: "T", hp: 3 }],
      resolve: () => { throw new Error("resolve failure"); },
    });

    expect(() => game.resolveDecision({ decisionId: id, choices: ["U1"] }))
      .toThrow("resolve failure");

    // The _isExecutingResolution guard must be released even on error
    expect(game._isExecutingResolution).toBe(false);

    // The decision stack must be cleaned up even when the resolve callback
    // throws — a buggy callback shouldn't leave the game stuck in RESOLVING.
    expect(game.pendingDecision).toBeNull();
    expect(game._resolutionState).toBe(ResolutionState.IDLE);
    expect(game._resolutionDepth).toBe(0);
  });
});
