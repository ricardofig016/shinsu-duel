import WhateverPlaystyle from "../../playstyles/WhateverPlaystyle.js";

/** A decision as it appears in a seat view; ids may be anything the engine chose. */
const decision = (overrides = {}) => ({
  decisionId: "d1",
  type: "target_selection",
  candidates: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }],
  minChoices: 1,
  maxChoices: 1,
  lockedIds: [],
  ...overrides,
});

describe("WhateverPlaystyle", () => {
  const playstyle = new WhateverPlaystyle();

  test("always passes, whatever the view says", () => {
    for (const view of [null, undefined, {}, { you: { passButton: { isEnabled: true } } }]) {
      expect(playstyle.decideTurn(view, { next: () => 0.5 })).toEqual({ type: "pass-turn-action", data: {} });
    }
  });

  test("resolves a decision with the first free candidates up to minChoices", () => {
    expect(playstyle.resolveDecision(decision())).toEqual({ decisionId: "d1", choices: ["a"] });
    expect(playstyle.resolveDecision(decision({ minChoices: 2, maxChoices: 2 }))).toEqual({
      decisionId: "d1",
      choices: ["a", "b"],
    });
  });

  test("never submits a locked candidate", () => {
    const resolved = playstyle.resolveDecision(decision({ lockedIds: ["a"], minChoices: 2, maxChoices: 2 }));
    expect(resolved.choices).toEqual(["b", "c"]);
  });

  test("defaults the choice count to one when a decision omits its range", () => {
    const resolved = playstyle.resolveDecision({ decisionId: "d2", candidates: [{ id: "x" }, { id: "y" }] });
    expect(resolved).toEqual({ decisionId: "d2", choices: ["x"] });
  });
});
