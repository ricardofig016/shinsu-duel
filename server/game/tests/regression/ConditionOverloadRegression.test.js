/**
 * Regression: condition-field overload in EffectResolver.
 *
 * Bug: EffectResolver treated the `condition` DSL field as a target filter
 * for ALL effect types. On give_condition, that filtered targets to only
 * units that already had the condition — making it impossible to apply a
 * condition to a fresh target.
 *
 * Also: the same bug existed in the all_enemies resolution path.
 *
 * Fixed 2026-08-11 by scoping condition-as-filter to only deal_damage.
 */

import { resolveEffect } from "../../EffectResolver.js";
import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import { getCardIdByName, createLegalDeck } from "../utils.js";

const players = ["Alice", "Bob"];

function makeUnit(name, owner) {
  const cid = getCardIdByName(name);
  const data = GameState.cards[cid];
  return {
    id: name + "#" + owner,
    owner,
    card: new Card(cid, data, owner, { on() {} }),
    currentHp: data.hp,
    placedPositionCode: "scout",
    isAlive() { return this.currentHp > 0; },
  };
}

describe("condition-field regression (EffectResolver)", () => {
  test("give_condition with target descriptor applies to fresh enemies", () => {
    const game = new GameState("TEST", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    }, null, { rng: new SeededRng(1) });

    const src = makeUnit("Monkeyman", "Alice");
    const victim = makeUnit("Monkeyman", "Bob");
    game.playerStates.Alice.field.frontline.push(src);
    game.playerStates.Bob.field.frontline.push(victim);

    expect(game.modifierStack.has(victim.id, "condition", "poisoned")).toBe(false);

    const ctx = { emitChild(evt, payload) { game.eventBus.emit(evt, payload); } };
    const result = resolveEffect(
      {
        type: "give_condition", condition: "poisoned", amount: 2,
        target: "enemy", raw: "give Poisoned 2 to an enemy", handler: null,
      },
      ctx, game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice", sourceType: "unit" }
    );

    const effective = game.modifierStack.getEffective(victim.id, "condition", "poisoned");
    expect(effective).toBe(2);
    expect(result).not.toEqual(expect.objectContaining({ skipped: true }));
  });

  test("give_condition to 'all_enemies' also reaches fresh targets", () => {
    const game = new GameState("TEST", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    }, null, { rng: new SeededRng(1) });

    const src = makeUnit("Monkeyman", "Alice");
    const victim = makeUnit("Monkeyman", "Bob");
    game.playerStates.Alice.field.frontline.push(src);
    game.playerStates.Bob.field.frontline.push(victim);

    const ctx = { emitChild(evt, payload) { game.eventBus.emit(evt, payload); } };
    resolveEffect(
      {
        type: "give_condition", condition: "burned", amount: 1,
        target: "all_enemies", raw: "give Burned 1 to all enemies", handler: null,
      },
      ctx, game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice", sourceType: "unit" }
    );

    expect(game.modifierStack.getEffective(victim.id, "condition", "burned")).toBe(1);
  });

  test("deal_damage with condition filter still works correctly", () => {
    const game = new GameState("TEST", players, {
      Alice: createLegalDeck(),
      Bob: createLegalDeck(),
    }, null, { rng: new SeededRng(1) });

    const src = makeUnit("Monkeyman", "Alice");
    const victim = makeUnit("Monkeyman", "Bob");
    game.playerStates.Alice.field.frontline.push(src);
    game.playerStates.Bob.field.frontline.push(victim);

    const hpBefore = victim.currentHp;

    const ctx = { emitChild(evt, payload) { game.eventBus.emit(evt, payload); } };
    resolveEffect(
      {
        type: "deal_damage", amount: 99,
        target: "all_enemies", condition: "rooted",
        raw: "deal 99 to all Rooted enemies", handler: null,
      },
      ctx, game,
      { owner: "Alice", sourceId: src.id, sourceUnit: src, sourceOwner: "Alice" }
    );

    expect(victim.currentHp).toBe(hpBefore);
  });
});
