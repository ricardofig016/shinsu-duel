/**
 * Shared-target sequence resolution.
 *
 * A `sequence` that declares a shared `targets` descriptor resolves that target
 * set ONCE; steps referencing it via `target: { link: sequence }` act on the
 * same set (optionally a `count: N` subset). Regression coverage for:
 *   - single/multiple/empty shared sets
 *   - exactly ONE decision for the shared set (a subset step may add a second)
 *   - guards against link steps outside a shared sequence
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

function unit(id, owner, position = "scout", { maxHp = 10 } = {}) {
  return {
    id,
    owner,
    placedPositionCode: position,
    currentHp: maxHp,
    card: { name: id, maxHp, affiliations: {}, attributes: [], rank: "regular" },
    isAlive() { return this.currentHp > 0; },
  };
}

function push(game, owner, u, line = "frontline") {
  game.playerStates[owner].field[line].push(u);
  return u;
}

function context(game) {
  return { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) };
}

describe("shared-target sequence resolution", () => {
  test("single candidate resolves both steps without a decision", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const enemy = push(game, "Bob", unit("e1", "Bob"));

    resolveEffect(
      {
        type: "sequence",
        targets: { side: "enemy" },
        steps: [
          { type: "deal_damage", amount: 2, target: { link: "sequence" }, raw: "deal 2" },
          { type: "give_condition", condition: "burned", target: { link: "sequence" }, raw: "give Burned" },
        ],
      },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(game.pendingDecision).toBeNull();
    expect(enemy.currentHp).toBe(8);
    expect(game.modifierStack.has(enemy.id, "condition", "burned")).toBe(true);
  });

  test("multiple candidates produce ONE decision; both steps hit every chosen target", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const e1 = push(game, "Bob", unit("e1", "Bob"));
    const e2 = push(game, "Bob", unit("e2", "Bob"));
    const e3 = push(game, "Bob", unit("e3", "Bob"));

    const result = resolveEffect(
      {
        type: "sequence",
        targets: { side: "enemy", count: 3 },
        steps: [
          { type: "deal_damage", amount: 2, target: { link: "sequence" }, raw: "deal 2" },
          { type: "give_condition", condition: "burned", target: { link: "sequence" }, raw: "give Burned" },
        ],
      },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ resolved: true, pending: true });
    expect(game.pendingDecision.type).toBe("target_selection");
    expect(game.pendingDecision.candidates).toHaveLength(3);

    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [e1.id, e2.id, e3.id],
      username: "Alice",
    });

    expect(game.pendingDecision).toBeNull();
    for (const e of [e1, e2, e3]) {
      expect(e.currentHp).toBe(8);
      expect(game.modifierStack.has(e.id, "condition", "burned")).toBe(true);
    }
  });

  test("subset step (count: 1) creates a second decision restricted to the shared set", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));
    const e1 = push(game, "Bob", unit("e1", "Bob"));
    const e2 = push(game, "Bob", unit("e2", "Bob"));

    resolveEffect(
      {
        type: "sequence",
        targets: { side: "enemy", count: 2 },
        steps: [
          { type: "deal_damage", amount: 1, target: { link: "sequence" }, raw: "deal 1" },
          { type: "give_condition", condition: "burned", target: { link: "sequence", count: 1 }, raw: "give Burned 1 to one of them" },
        ],
      },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    // Resolve the shared set first.
    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [e1.id, e2.id],
      username: "Alice",
    });

    // Both took damage; a subset decision now asks for ONE of the two.
    expect(e1.currentHp).toBe(9);
    expect(e2.currentHp).toBe(9);
    expect(game.pendingDecision.type).toBe("target_selection");
    expect(game.pendingDecision.candidates.map((c) => c.id).sort()).toEqual([e1.id, e2.id].sort());
    expect(game.pendingDecision.minChoices).toBe(1);
    expect(game.pendingDecision.maxChoices).toBe(1);

    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [e1.id],
      username: "Alice",
    });

    expect(game.pendingDecision).toBeNull();
    expect(game.modifierStack.has(e1.id, "condition", "burned")).toBe(true);
    expect(game.modifierStack.has(e2.id, "condition", "burned")).toBe(false);
  });

  test("empty shared set is a legal no-op", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));

    const result = resolveEffect(
      {
        type: "sequence",
        targets: { side: "enemy" },
        steps: [
          { type: "deal_damage", amount: 2, target: { link: "sequence" }, raw: "deal 2" },
        ],
      },
      context(game), game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ resolved: true, skipped: true, reason: "no valid targets" });
    expect(game.pendingDecision).toBeNull();
  });

  test("random shared selection picks exactly the requested count, deterministically", () => {
    const run = () => {
      const game = createGame();
      const src = push(game, "Alice", unit("src", "Alice"));
      const e1 = push(game, "Bob", unit("e1", "Bob"));
      const e2 = push(game, "Bob", unit("e2", "Bob"));
      const e3 = push(game, "Bob", unit("e3", "Bob"));

      resolveEffect(
        {
          type: "sequence",
          targets: { side: "enemy", count: 2, random: true },
          steps: [
            { type: "deal_damage", amount: 1, target: { link: "sequence" }, raw: "deal 1" },
          ],
        },
        context(game), game,
        { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
      );

      return [e1, e2, e3].filter((e) => e.currentHp === 9).map((e) => e.id);
    };

    const first = run();
    const second = run();

    expect(first).toHaveLength(2);
    expect(first).toEqual(second);
  });

  test("a link step inside a sequence without `targets` throws", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));

    expect(() =>
      resolveEffect(
        {
          type: "sequence",
          steps: [
            { type: "deal_damage", amount: 2, target: { link: "sequence" }, raw: "deal 2" },
          ],
        },
        context(game), game,
        { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
      )
    ).toThrow(/declare `targets`/);
  });

  test("a link target reached outside a shared sequence throws", () => {
    const game = createGame();
    const src = push(game, "Alice", unit("src", "Alice"));

    expect(() =>
      resolveEffect(
        { type: "deal_damage", amount: 2, target: { link: "sequence" }, raw: "deal 2" },
        context(game), game,
        { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
      )
    ).toThrow(/enclosing sequence/);
  });
});
