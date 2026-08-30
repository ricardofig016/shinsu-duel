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

function unit(id, owner, position = "fisherman", { name = id, maxHp = 20 } = {}) {
  return {
    id,
    owner,
    placedPositionCode: position,
    currentHp: maxHp,
    card: { name, maxHp },
    equipmentAttachments: [],
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

describe("EffectResolver structural nodes", () => {
  test("sequence runs its steps in order", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const enemy = push(game, "Bob", unit("enemy", "Bob"));
    src.currentHp = 10;

    const result = resolveEffect({
      type: "sequence",
      steps: [
        { type: "deal_damage", amount: 2, target: { side: "enemy" } },
        { type: "heal", amount: 1, target: { side: "self" } },
      ],
    }, context(game), game, { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" });

    expect(result.resolved).toBe(true);
    expect(enemy.currentHp).toBe(18);
    expect(src.currentHp).toBe(11);
  });

  test("conditional resolves `then` when the predicate is true, `otherwise` when false", () => {
    const game = createGame();
    const enemy = push(game, "Bob", unit("enemy", "Bob"));
    const node = {
      type: "conditional",
      if: { type: "has_unit", target: { side: "ally", name: "Yeo Miseng" } },
      then: { type: "deal_damage", amount: 5, target: { side: "enemy" } },
      otherwise: { type: "deal_damage", amount: 1, target: { side: "enemy" } },
    };

    // Predicate false → otherwise (1 damage)
    resolveEffect(node, context(game), game, { owner: "Alice", sourceId: "src", sourceOwner: "Alice" });
    expect(enemy.currentHp).toBe(19);

    // Predicate true → then (5 damage)
    push(game, "Alice", unit("miseng", "Alice", "scout", { name: "Yeo Miseng" }));
    resolveEffect(node, context(game), game, { owner: "Alice", sourceId: "src", sourceOwner: "Alice" });
    expect(enemy.currentHp).toBe(14);
  });

  test("conditional with no matching branch is a legal no-op", () => {
    const game = createGame();
    const result = resolveEffect({
      type: "conditional",
      if: { type: "has_unit", target: { side: "ally", name: "Yeo Miseng" } },
      then: { type: "deal_damage", amount: 5, target: { side: "enemy" } },
    }, context(game), game, { owner: "Alice", sourceOwner: "Alice" });

    expect(result).toEqual({ resolved: true });
  });

  test("a sequence nested inside a conditional branch resolves fully", () => {
    const game = createGame();
    push(game, "Alice", unit("miseng", "Alice", "scout", { name: "Yeo Miseng" }));
    const src = push(game, "Alice", unit("src", "Alice"));
    const enemy = push(game, "Bob", unit("enemy", "Bob"));
    src.currentHp = 10;

    resolveEffect({
      type: "conditional",
      if: { type: "has_unit", target: { side: "ally", name: "Yeo Miseng" } },
      then: {
        type: "sequence",
        steps: [
          { type: "deal_damage", amount: 2, target: { side: "enemy" } },
          { type: "heal", amount: 1, target: { side: "self" } },
        ],
      },
    }, context(game), game, { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" });

    expect(enemy.currentHp).toBe(18);
    expect(src.currentHp).toBe(11);
  });

  test("an unknown effect type throws, at the top level and inside a resolved branch", () => {
    const game = createGame();
    push(game, "Alice", unit("miseng", "Alice", "scout", { name: "Yeo Miseng" }));

    expect(() => resolveEffect(
      { type: "synthetic_unregistered_effect", raw: "unknown top level" },
      context(game), game, { owner: "Alice", sourceOwner: "Alice" },
    )).toThrow('EffectResolver: unknown effect type "synthetic_unregistered_effect"');

    expect(() => resolveEffect({
      type: "conditional",
      if: { type: "has_unit", target: { side: "ally", name: "Yeo Miseng" } },
      then: { type: "synthetic_unregistered_effect", raw: "unknown leaf" },
    }, context(game), game, { owner: "Alice", sourceOwner: "Alice" }))
      .toThrow('EffectResolver: unknown effect type "synthetic_unregistered_effect"');
  });

  test("sequence defers remaining steps while a target choice is pending", () => {
    const game = createGame();
    const e1 = push(game, "Bob", unit("e1", "Bob"));
    const e2 = push(game, "Bob", unit("e2", "Bob"));

    const result = resolveEffect({
      type: "sequence",
      steps: [
        { type: "deal_damage", amount: 1, target: "enemy" },
        { type: "deal_damage", amount: 1, target: "enemy" },
      ],
    }, context(game), game, { owner: "Alice", sourceOwner: "Alice" });

    expect(result.pending).toBe(true);
    expect(e1.currentHp).toBe(20);
    expect(e2.currentHp).toBe(20);

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: [e1.id] });
    expect(e1.currentHp).toBe(19);
    expect(e2.currentHp).toBe(20);
    expect(game.pendingDecision).not.toBeNull();

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: [e2.id] });
    expect(e2.currentHp).toBe(19);
    expect(game.pendingDecision).toBeNull();
  });

  test("sequence without a steps array throws", () => {
    const game = createGame();
    expect(() => resolveEffect({ type: "sequence" }, context(game), game, { owner: "Alice" }))
      .toThrow("sequence requires a `steps` array");
  });

  test("conditional without an if predicate throws", () => {
    const game = createGame();
    expect(() => resolveEffect({ type: "conditional" }, context(game), game, { owner: "Alice" }))
      .toThrow("conditional requires an `if` predicate");
  });
});
