/**
 * Regression: multi-target enemy selection must lock targetable Taunt units,
 * auto-resolve when there is no genuine choice, and respect Blinded/ignore_taunt.
 *
 * Bug: `{ side: enemy, count: N }` collapsed the candidate pool to Taunt units,
 * so the player could never fill remaining slots with non-Taunts, and a forced
 * decision was created even when every legal target was already determined.
 */

import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck, cards } from "../utils.js";
import { resolveEffect } from "../../EffectResolver.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1), cards });
}

function unit(id, owner) {
  return {
    id,
    owner,
    placedPositionCode: "scout",
    currentHp: 10,
    card: { name: id, maxHp: 10, affiliations: {}, attributes: [], rank: "regular" },
    isAlive() { return this.currentHp > 0; },
  };
}

function push(game, owner, u) {
  game.playerStates[owner].field.frontline.push(u);
  return u;
}

function context(game) {
  return { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) };
}

function grantTaunt(game, u) {
  game.modifierStack.apply({ sourceId: "system", sourceType: "system", targetId: u.id, type: "trait", key: "taunt", value: 1 });
}

function grantBlinded(game, u) {
  game.modifierStack.apply({ sourceId: "system", sourceType: "system", targetId: u.id, type: "condition", key: "blinded", value: 1 });
}

function grantIgnoreTaunt(game, u) {
  game.modifierStack.apply({ sourceId: "Passive#s#0", sourceType: "passive", targetId: u.id, type: "keyword", key: "ignore_taunt", value: 1, meta: { first: false } });
}

describe("Taunt multi-target selection regressions", () => {
  test("Taunt units equal to the count are auto-selected with no decision", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const t1 = push(game, "Bob", unit("t1", "Bob"));
    const t2 = push(game, "Bob", unit("t2", "Bob"));
    grantTaunt(game, t1);
    grantTaunt(game, t2);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(game.pendingDecision).toBeNull();
    expect(t1.currentHp).toBe(9);
    expect(t2.currentHp).toBe(9);
  });

  test("fewer Taunt units than the count are locked and only the free slot is chosen", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const taunter = push(game, "Bob", unit("taunter", "Bob"));
    const other1 = push(game, "Bob", unit("other1", "Bob"));
    const other2 = push(game, "Bob", unit("other2", "Bob"));
    grantTaunt(game, taunter);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.lockedIds).toEqual(["taunter"]);
    expect(game.pendingDecision.minChoices).toBe(1);
    expect(game.pendingDecision.maxChoices).toBe(1);
    expect(game.pendingDecision.candidates.map((c) => c.id).sort()).toEqual(["other1", "other2"]);

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: ["other1"] });

    expect(taunter.currentHp).toBe(9);
    expect(other1.currentHp).toBe(9);
    expect(other2.currentHp).toBe(10);
  });

  test("ignore_taunt bypasses Taunt locking for multi-target selection", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const taunter = push(game, "Bob", unit("taunter", "Bob"));
    const other1 = push(game, "Bob", unit("other1", "Bob"));
    const other2 = push(game, "Bob", unit("other2", "Bob"));
    grantTaunt(game, taunter);
    grantIgnoreTaunt(game, src);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.lockedIds).toEqual([]);
    expect(game.pendingDecision.maxChoices).toBe(2);
    expect(game.pendingDecision.candidates.map((c) => c.id).sort()).toEqual(["other1", "other2", "taunter"]);
  });

  test("Blinded single-target auto-selects randomly without a decision", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const e1 = push(game, "Bob", unit("e1", "Bob"));
    const e2 = push(game, "Bob", unit("e2", "Bob"));
    grantBlinded(game, src);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    expect(game.pendingDecision).toBeNull();
    expect([e1.currentHp, e2.currentHp].filter((hp) => hp === 9)).toHaveLength(1);
  });

  test("Blinded multi-target auto-selects the requested count without a decision", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const e1 = push(game, "Bob", unit("e1", "Bob"));
    const e2 = push(game, "Bob", unit("e2", "Bob"));
    const e3 = push(game, "Bob", unit("e3", "Bob"));
    grantBlinded(game, src);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(game.pendingDecision).toBeNull();
    expect([e1.currentHp, e2.currentHp, e3.currentHp].filter((hp) => hp === 9)).toHaveLength(2);
  });

  test("Blinded multi-target still respects Taunt (Taunt locked, free slots randomized)", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const taunter = push(game, "Bob", unit("taunter", "Bob"));
    const other1 = push(game, "Bob", unit("other1", "Bob"));
    const other2 = push(game, "Bob", unit("other2", "Bob"));
    grantTaunt(game, taunter);
    grantBlinded(game, src);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(game.pendingDecision).toBeNull();
    expect(taunter.currentHp).toBe(9);
    expect([other1.currentHp, other2.currentHp].filter((hp) => hp === 9)).toHaveLength(1);
  });

  test("more Taunt units than the count lets the player choose among them", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const t1 = push(game, "Bob", unit("t1", "Bob"));
    const t2 = push(game, "Bob", unit("t2", "Bob"));
    const t3 = push(game, "Bob", unit("t3", "Bob"));
    const other = push(game, "Bob", unit("other", "Bob"));
    grantTaunt(game, t1);
    grantTaunt(game, t2);
    grantTaunt(game, t3);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.lockedIds).toEqual([]);
    expect(game.pendingDecision.minChoices).toBe(2);
    expect(game.pendingDecision.maxChoices).toBe(2);
    expect(game.pendingDecision.candidates.map((c) => c.id).sort()).toEqual(["t1", "t2", "t3"]);

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: ["t1", "t3"] });
    expect(t1.currentHp).toBe(9);
    expect(t3.currentHp).toBe(9);
    expect(t2.currentHp).toBe(10);
    expect(other.currentHp).toBe(10);
  });

  test("a single-target frontline effect targets the Taunt unit automatically", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const taunter = push(game, "Bob", unit("taunter", "Bob"));
    const other = push(game, "Bob", unit("other", "Bob"));
    grantTaunt(game, taunter);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", scope: "frontline" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(game.pendingDecision).toBeNull();
    expect(taunter.currentHp).toBe(9);
    expect(other.currentHp).toBe(10);
  });

  test("a single-target frontline effect with two Taunts lets the player choose among them", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const t1 = push(game, "Bob", unit("t1", "Bob"));
    const t2 = push(game, "Bob", unit("t2", "Bob"));
    const other = push(game, "Bob", unit("other", "Bob"));
    grantTaunt(game, t1);
    grantTaunt(game, t2);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", scope: "frontline" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.lockedIds).toEqual([]);
    expect(game.pendingDecision.minChoices).toBe(1);
    expect(game.pendingDecision.maxChoices).toBe(1);
    expect(game.pendingDecision.candidates.map((c) => c.id).sort()).toEqual(["t1", "t2"]);

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: ["t2"] });
    expect(t2.currentHp).toBe(9);
    expect(t1.currentHp).toBe(10);
    expect(other.currentHp).toBe(10);
  });

  test("a single-target backline effect targets the Taunt unit in the backline", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const taunter = unit("taunter", "Bob");
    const other = unit("other", "Bob");
    game.playerStates.Bob.field.backline.push(taunter, other);
    grantTaunt(game, taunter);

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", scope: "backline" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(game.pendingDecision).toBeNull();
    expect(taunter.currentHp).toBe(9);
    expect(other.currentHp).toBe(10);
  });

  test("a multi-target ally effect auto-resolves when the ally count matches", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const ally1 = push(game, "Alice", unit("ally1", "Alice"));
    const ally2 = push(game, "Alice", unit("ally2", "Alice"));

    const result = resolveEffect(
      { type: "grant_trait", trait: "strong", amount: 1, target: { side: "ally", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(game.pendingDecision).toBeNull();
    expect(game.modifierStack.getEffective(ally1.id, "trait", "strong")).toBe(1);
    expect(game.modifierStack.getEffective(ally2.id, "trait", "strong")).toBe(1);
  });

  test("the pending-decision event surfaces lockedIds", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const taunter = push(game, "Bob", unit("taunter", "Bob"));
    const other1 = push(game, "Bob", unit("other1", "Bob"));
    const other2 = push(game, "Bob", unit("other2", "Bob"));
    grantTaunt(game, taunter);

    const events = [];
    game.eventBus.on("pending-decision", (payload) => events.push(payload));

    resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(events).toHaveLength(1);
    expect(events[0].lockedIds).toEqual(["taunter"]);
  });
});
