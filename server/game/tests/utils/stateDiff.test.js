import { applyStateDiff, computeStateDiff } from "../../utils/stateDiff.js";

function baseState() {
  return {
    round: 1,
    currentTurn: "Alice",
    players: {
      Alice: {
        lighthouses: 18,
        shinsu: { normalSpent: 2, normalAvailable: 4, recharged: 1 },
        deck: [{ cardId: 7, id: "Card#7#1", costReduction: 0 }, { cardId: 9, id: "Card#9#2", costReduction: 1 }],
        hand: [{ handId: 1, cardId: 3 }],
        combatSlots: [null, { unitId: "Unit#A" }, null],
      },
      Bob: {
        lighthouses: 20,
        shinsu: { normalSpent: 0, normalAvailable: 6, recharged: 0 },
        deck: [{ cardId: 4, id: "Card#4#1", costReduction: 0 }],
        hand: [],
        combatSlots: [null, null, null],
      },
    },
    modifiers: [{ id: 1, kind: "burn" }],
    pendingDecision: null,
  };
}

function afterPassTurn() {
  const state = structuredClone(baseState());
  state.currentTurn = "Bob";
  state.players.Alice.shinsu.normalSpent = 3;
  state.players.Bob.shinsu.normalAvailable = 7;
  state.modifiers.push({ id: 2, kind: "poison" });
  return state;
}

describe("computeStateDiff", () => {
  test("records changed scalars by dotted path and nothing else", () => {
    const before = baseState();
    const after = baseState();
    after.players.Alice.shinsu.normalAvailable = 5;

    const diff = computeStateDiff(before, after);
    expect(diff).toEqual({ changed: { "players.Alice.shinsu.normalAvailable": 5 }, removed: [] });
  });

  test("records additions and trailing array removals positionally", () => {
    const before = baseState();
    const after = structuredClone(before);
    after.players.Alice.deck.shift(); // draw removes the first card
    after.players.Alice.hand.push({ handId: 2, cardId: 9 });

    const diff = computeStateDiff(before, after);
    expect(diff.removed).toEqual(["players.Alice.deck.1"]);
    expect(diff.changed["players.Alice.hand.1"]).toEqual({ handId: 2, cardId: 9 });
  });

  test("records whole values on type changes", () => {
    const before = baseState();
    const after = structuredClone(before);
    after.pendingDecision = { decisionId: 3, candidates: ["Unit#A"] };

    expect(computeStateDiff(before, after).changed.pendingDecision).toEqual({
      decisionId: 3,
      candidates: ["Unit#A"],
    });

    const back = computeStateDiff(after, before);
    expect(back.changed.pendingDecision).toBeNull();
  });

  test("records removed object keys and whole added subtrees", () => {
    const before = baseState();
    const after = structuredClone(before);
    delete after.players.Alice.hand;
    after.grantedAbilities = [{ unitId: "Unit#A", code: "X" }];

    const diff = computeStateDiff(before, after);
    expect(diff.removed).toEqual(["players.Alice.hand"]);
    expect(diff.changed.grantedAbilities).toEqual([{ unitId: "Unit#A", code: "X" }]);
  });

  test("a pair of identical states yields an empty diff", () => {
    const state = baseState();
    expect(computeStateDiff(state, structuredClone(state))).toEqual({ changed: {}, removed: [] });
  });
});

describe("applyStateDiff", () => {
  test("applying a computed diff reproduces the after-state exactly", () => {
    const before = baseState();
    const after = afterPassTurn();

    const applied = applyStateDiff(before, computeStateDiff(before, after));
    expect(JSON.stringify(applied)).toBe(JSON.stringify(after));
  });

  test("applying diffs is chainable and never mutates the input state", () => {
    const initial = baseState();
    const step1 = afterPassTurn();
    const step2 = structuredClone(step1);
    step2.currentTurn = "Alice";
    step2.players.Alice.lighthouses = 19;
    step2.modifiers.pop();

    const snapshot = JSON.stringify(initial);
    const once = applyStateDiff(initial, computeStateDiff(initial, step1));
    const twice = applyStateDiff(once, computeStateDiff(step1, step2));

    expect(JSON.stringify(twice)).toBe(JSON.stringify(step2));
    expect(JSON.stringify(initial)).toBe(snapshot);
    expect(JSON.stringify(once)).not.toBe(snapshot);
  });

  test("array truncation keeps the array hole-free across multiple removals", () => {
    const before = { modifiers: [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }] };
    const after = { modifiers: [{ id: 1 }] };

    const applied = applyStateDiff(before, computeStateDiff(before, after));
    expect(applied.modifiers).toEqual([{ id: 1 }]);
    expect(applied.modifiers.length).toBe(1);
  });

  test("throws loudly on a malformed diff instead of producing a wrong state", () => {
    expect(() => applyStateDiff({ a: 1 }, { changed: null, removed: [] })).toThrow(TypeError);
    expect(() => applyStateDiff({ a: 1 }, { changed: { "b.c": 1 }, removed: [] })).toThrow(/not an object/);
    expect(() => applyStateDiff({ a: 1 }, { changed: {}, removed: ["missing.key"] })).toThrow(/malformed/);
    expect(() => applyStateDiff({ a: {} }, { changed: {}, removed: ["a.missing"] })).toThrow(/does not exist/);
    expect(() =>
      applyStateDiff({ list: [1, 2, 3] }, { changed: {}, removed: ["list.0", "list.2"] })
    ).toThrow(/trailing block/);
    expect(() => applyStateDiff({ list: [1, 2] }, { changed: { "list.9": 1 }, removed: [] })).toThrow(/beyond the array/);
  });
});
