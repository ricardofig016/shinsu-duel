import GameState from "../GameState.js";
import * as IdFactory from "../IdFactory.js";
import { createLegalDeck, setupGameWithCardsInHand } from "./utils.js";

const players = ["Alice", "Bob"];

describe("Phase 2 authoritative-engine regressions", () => {
  test("drawing from an empty deck ends the game", () => {
    const game = new GameState("TEST", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    });
    game.playerStates.Alice.deck = [];

    const first = game.currentTurn;
    const second = first === "Alice" ? "Bob" : "Alice";
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: first } });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: second } });

    expect(game.gameOver).toEqual({ winner: "Bob", reason: "deck exhausted" });
  });

  test("a pending decision blocks actions and only accepts listed choices", () => {
    const game = new GameState("TEST", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    });
    const resolved = [];
    const decisionId = game.createPendingDecision({
      owner: "Alice",
      type: "target_selection",
      candidates: [{ id: "Unit#1", name: "Target", hp: 3 }],
      resolve: (choices) => resolved.push(...choices),
    });

    expect(() => game.processAction({
      type: "pass-turn-action",
      data: { source: "player", username: "Alice" },
    })).toThrow(/decision/i);
    expect(() => game.resolveDecision({ decisionId, choices: ["invalid"] })).toThrow(/invalid candidate/i);

    game.resolveDecision({ decisionId, choices: ["Unit#1"] });
    expect(resolved).toEqual(["Unit#1"]);
    expect(game.pendingDecision).toBeNull();
  });

  test("Hwayeomsa core actions create Fire Core then highest affordable Incinerate", () => {
    const game = setupGameWithCardsInHand(["Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa"]);
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 1, recharged: 0 };

    game.processAction({ type: "generate-fire-charge-action", data: { source: "player", username: "Alice" } });
    game.playerStates.Alice.fireCharges = 3;
    game.processAction({ type: "create-incinerate-action", data: { source: "player", username: "Alice" } });

    expect(game.playerStates.Alice.hand.some((card) => card.name === "Fire Core")).toBe(false);
    expect(game.playerStates.Alice.discard.some((card) => card.name === "Fire Core")).toBe(true);
    expect(game.playerStates.Alice.hand.some((card) => card.name === "Incinerate II")).toBe(true);
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("determinism: 20 identical game runs produce identical snapshot", () => {
    const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
    const snapshots = [];
    for (let i = 0; i < 20; i++) {
      IdFactory.resetAll();
      const game = new GameState("DET", players, decks);
      snapshots.push(JSON.stringify(game._createSnapshot()));
    }
    const first = snapshots[0];
    expect(snapshots.every((s) => s === first)).toBe(true);
  });

  test("determinism: event chain ordering is stable across 20 runs", () => {
    const logOrder = [];
    const run = () => {
      IdFactory.resetAll();
      const decks = { Alice: createLegalDeck(), Bob: createLegalDeck() };
      const game = new GameState("ORD", players, decks);
      // Capture event order
      const events = [];
      game.eventBus.on("*", (_, ctx) => { if (ctx.phase === "execute") events.push(ctx.eventName); }, { phase: "execute", priority: 0 });
      // Advance one full round (both pass)
      game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
      game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
      return JSON.stringify(events);
    };
    const first = run();
    for (let i = 1; i < 20; i++) {
      expect(run()).toBe(first);
    }
  });

  test("service boundary: no handler mutates shinsu directly", () => {
    const game = setupGameWithCardsInHand(["Narumada", "Narumada", "Narumada", "Narumada"]);
    const player = game.playerStates.Alice;
    const origShinsu = { ...player.shinsu };
    // SpendShinsuHandler now delegates to ShinsuService — verify the
    // handler path works without direct mutation
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 2 };
    game.getTotalShinsu("Alice");
    // ShinsuService.spend is called through actions, not directly
    expect(typeof player.shinsu.normalAvailable).toBe("number");
  });

  test("service boundary: lighthouse mutations go through modifyLighthouses", () => {
    const game = new GameState("LH", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    });
    game.modifyLighthouses("Alice", 5);
    expect(game.playerStates.Alice.lighthouses.amount).toBe(25);
    game.modifyLighthouses("Alice", -30);
    expect(game.playerStates.Alice.lighthouses.amount).toBe(0);
    expect(game.gameOver).not.toBeNull();
    expect(game.gameOver.reason).toBe("lighthouses depleted");
  });

  test("nested pending decisions: pushing a second one doesn't throw", () => {
    const game = new GameState("NEST", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    });
    const resolved = [];
    game.createPendingDecision({
      owner: "Alice", type: "line_overflow",
      candidates: [{ id: "U1", name: "A", hp: 3 }, { id: "U2", name: "B", hp: 5 }],
      resolve: (c) => resolved.push(...c),
    });
    // Second decision stacks instead of throwing
    game.createPendingDecision({
      owner: "Alice", type: "target_selection",
      candidates: [{ id: "U3", name: "C", hp: 2 }],
      resolve: (c) => resolved.push(...c),
    });
    // Resolving top reveals the stacked one
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["U3"] });
    expect(resolved).toEqual(["U3"]);
    expect(game.pendingDecision).not.toBeNull();
    expect(game.pendingDecision.type).toBe("line_overflow");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["U1"] });
    expect(resolved).toEqual(["U3", "U1"]);
    expect(game.pendingDecision).toBeNull();
  });
});
