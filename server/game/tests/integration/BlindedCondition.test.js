import { resolveTargets } from "../../TargetResolver.js";
import { createTestGame } from "../utils.js";

function unit(id, owner) { return { id, owner, isAlive: () => true, card: { rank: "regular" } }; }
function srng(...v) { let i = 0; return { next: () => v[i++ % v.length] }; }

describe("Blinded condition", () => {
  function makeGame() {
    const g = createTestGame();
    g.playerStates.Alice.field.frontline = [];
    g.playerStates.Alice.field.backline = [];
    g.playerStates.Bob.field.frontline = [];
    g.playerStates.Bob.field.backline = [];
    return g;
  }

  test("Blinded randomizes enemy choice", () => {
    const game = makeGame();
    game._rng = srng(0.0, 0.0);
    const src = unit("X", "Alice");
    game.playerStates.Alice.field.frontline.push(src);
    game.playerStates.Bob.field.frontline.push(unit("A", "Bob"), unit("B", "Bob"));
    game.modifierStack.apply({ sourceId: "s", sourceType: "system", targetId: src.id, type: "condition", key: "blinded", value: 1 });

    // f()=0.0: i=1 j=0 swap(B,A)→[B,A]; i=0 j=0 noop → [B,A]
    const r = resolveTargets(game, { target: "enemy", sourceUnit: src });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("B");
  });

  test("different seed gives different result", () => {
    const game = makeGame();
    game._rng = srng(0.99, 0.99);
    const src = unit("X", "Alice");
    game.playerStates.Alice.field.frontline.push(src);
    game.playerStates.Bob.field.frontline.push(unit("A", "Bob"), unit("B", "Bob"));
    game.modifierStack.apply({ sourceId: "s", sourceType: "system", targetId: src.id, type: "condition", key: "blinded", value: 1 });

    // f()=0.99: i=1 j=floor(1.98)=1 noop; i=0 j=0 noop → [A,B] (unchanged)
    const r = resolveTargets(game, { target: "enemy", sourceUnit: src });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("A");
  });

  test("Blinded does not affect self", () => {
    const game = makeGame();
    game._rng = srng(0.0);
    const src = unit("X", "Alice");
    game.playerStates.Alice.field.frontline.push(src);
    game.modifierStack.apply({ sourceId: "s", sourceType: "system", targetId: src.id, type: "condition", key: "blinded", value: 1 });
    expect(resolveTargets(game, { target: "self", sourceUnit: src })[0].id).toBe("X");
  });

  test("Blinded does not affect all_enemies", () => {
    const game = makeGame();
    game._rng = srng(0.0, 0.0);
    const src = unit("X", "Alice");
    game.playerStates.Alice.field.frontline.push(src);
    game.playerStates.Bob.field.frontline.push(unit("A", "Bob"), unit("B", "Bob"));
    game.modifierStack.apply({ sourceId: "s", sourceType: "system", targetId: src.id, type: "condition", key: "blinded", value: 1 });
    const r = resolveTargets(game, { target: "all_enemies", sourceUnit: src, count: 0 });
    expect(r).toHaveLength(2);
    expect(r[0].id).toBe("A");
  });
});
