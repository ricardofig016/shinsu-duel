/**
 * Integration: structured target descriptors through EffectResolver.
 *
 * Migrated cards author targets as `{ side, scope, count, ...filters }`.
 * EffectResolver translates these into the canonical string target + filter
 * fields before resolving, so registered handlers never receive an object
 * target (which would otherwise throw "targetId is required").
 */

import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck } from "../utils.js";
import { resolveEffect } from "../../EffectResolver.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1) });
}

function unit(id, owner, position, { name = id, maxHp = 10, affiliations = {}, attributes = [], rank = "regular" } = {}) {
  return {
    id,
    owner,
    placedPositionCode: position,
    currentHp: maxHp,
    card: { name, maxHp, affiliations, attributes, rank },
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

describe("structured target resolution via EffectResolver", () => {
  test("heal with { side: self } heals the source unit", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout"));
    src.currentHp = 4;

    resolveEffect(
      { type: "heal", amount: 3, target: { side: "self" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(src.currentHp).toBe(7);
  });

  test("deal_damage with { side: enemy, scope: all, condition } filters by condition", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout"));
    const burned = push(game, "Bob", unit("burned", "Bob", "scout"));
    const clean = push(game, "Bob", unit("clean", "Bob", "scout"));
    game.modifierStack.apply({ sourceId: "system", sourceType: "system", targetId: "burned", type: "condition", key: "burned", value: 1 });

    resolveEffect(
      { type: "deal_damage", amount: 2, target: { side: "enemy", scope: "all", condition: "burned" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(burned.currentHp).toBe(8);
    expect(clean.currentHp).toBe(10);
  });

  test("give_condition with a structured target applies to fresh enemies (no self-filter)", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout"));
    const victim = push(game, "Bob", unit("victim", "Bob", "scout"));

    resolveEffect(
      { type: "give_condition", condition: "poisoned", amount: 2, target: { side: "enemy" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getEffective(victim.id, "condition", "poisoned")).toBe(2);
  });

  test("heal with an affiliation filter targets only matching allies", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout"));
    const target = push(game, "Alice", unit("tgt", "Alice", "scout", { affiliations: { "team-chang": {} } }));
    const other = push(game, "Alice", unit("other", "Alice", "scout", { affiliations: { "fug": {} } }));
    target.currentHp = 3;
    other.currentHp = 3;

    resolveEffect(
      { type: "heal", amount: 2, target: { side: "ally", affiliation: "team-chang" } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(target.currentHp).toBe(5);
    expect(other.currentHp).toBe(3);
  });

  test("heal with { shared_affiliation: true } heals only units sharing the source's affiliations (incl. self)", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout", { affiliations: { "team-chang": {} } }));
    const target = push(game, "Alice", unit("tgt", "Alice", "scout", { affiliations: { "team-chang": {} } }));
    const other = push(game, "Alice", unit("other", "Alice", "scout", { affiliations: { "fug": {} } }));
    src.currentHp = 3;
    target.currentHp = 3;
    other.currentHp = 3;

    resolveEffect(
      { type: "heal", amount: 2, target: { side: "ally", scope: "all", shared_affiliation: true } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(src.currentHp).toBe(5);
    expect(target.currentHp).toBe(5);
    expect(other.currentHp).toBe(3);
  });

  test("grant_trait with an affiliation array target does not throw and applies", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout"));
    const ally = push(game, "Alice", unit("ally", "Alice", "scout", { affiliations: { "wolhaiksong": {} } }));

    resolveEffect(
      { type: "grant_trait", trait: "strong", amount: 2, target: { side: "ally", affiliation: ["wolhaiksong", "team-sweet-and-sour"] } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getEffective(ally.id, "trait", "strong")).toBe(2);
  });

  test("deal_damage with { side: enemy, count: 2 } creates a multi-choice decision", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice", "scout"));
    push(game, "Bob", unit("e1", "Bob", "scout"));
    push(game, "Bob", unit("e2", "Bob", "scout"));

    const result = resolveEffect(
      { type: "deal_damage", amount: 1, target: { side: "enemy", count: 2 } },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.maxChoices).toBe(2);
  });
});
