import GameState from "../GameState.js";
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
});
