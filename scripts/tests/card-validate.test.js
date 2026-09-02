import { validateCard, validateCrossReferences } from "../card-validate.js";

// A schema-clean standard unit, mutated per test to exercise one kind rule.
function baseUnit(overrides = {}) {
  return {
    type: "unit",
    name: "Test Card",
    cost: 3,
    hp: 3,
    rank: "regular",
    positions: ["fisherman"],
    kind: "standard",
    traits: [],
    attributes: [],
    affiliations: [],
    abilities: [],
    passives: [],
    evolve: [],
    rules: [],
    deckConstraints: [],
    ...overrides,
  };
}

function errorsFor(card) {
  return validateCard(card, "test_card.yml").filter((e) => typeof e === "string");
}

describe("card-validate kind rules", () => {
  test("rejects a rank on a shinheuh", () => {
    const errors = errorsFor(baseUnit({ kind: "shinheuh", line: "frontline", rank: "regular", positions: [] }));
    expect(errors).toContain("rank: must be null/empty for shinheuh units");
  });

  test("rejects abilities on a landmark", () => {
    const errors = errorsFor(baseUnit({
      kind: "landmark",
      rank: undefined,
      positions: [],
      abilities: [{ type: "deal_damage", amount: 1, target: { side: "enemy" } }],
    }));
    expect(errors).toContain("abilities: landmark units cannot have abilities");
  });

  test("rejects abilities on a conduit", () => {
    const errors = errorsFor(baseUnit({
      kind: "conduit",
      rank: undefined,
      positions: [],
      abilities: [{ type: "deal_damage", amount: 1, target: { side: "enemy" } }],
      deckConstraints: [{ type: "unreachable", raw: "i am Unreachable" }],
    }));
    expect(errors).toContain("abilities: conduit units cannot have abilities");
  });

  test("rejects a shinheuh without a line", () => {
    const errors = errorsFor(baseUnit({ kind: "shinheuh", rank: undefined, positions: [] }));
    expect(errors).toContain("line: shinheuh units must declare a line of frontline or backline");
  });

  test("rejects a conduit without the unreachable constraint", () => {
    const errors = errorsFor(baseUnit({ kind: "conduit", rank: undefined, positions: [] }));
    expect(errors).toContain("deckConstraints: conduit units must be Unreachable");
  });

  test("rejects rules on a non-landmark unit", () => {
    const errors = errorsFor(baseUnit({ rules: [{ type: "disable_passives" }] }));
    expect(errors).toContain("rules: only landmark units declare rules (got standard)");
  });

  test("rejects a standard unit without positions", () => {
    const errors = errorsFor(baseUnit({ positions: [] }));
    expect(errors).toContain("positions: must be a non-empty array for standard units");
  });

  test("rejects positions on a shinheuh", () => {
    const errors = errorsFor(baseUnit({ kind: "shinheuh", line: "frontline", rank: undefined }));
    expect(errors).toContain("positions: must be empty for shinheuh units");
  });

  test("rejects evolve on a special kind", () => {
    const errors = errorsFor(baseUnit({ kind: "landmark", rank: undefined, positions: [], evolve: ["when i am deployed"] }));
    expect(errors).toContain("evolve: landmark units cannot evolve");
  });

  test("accepts a valid standard unit", () => {
    expect(errorsFor(baseUnit())).toEqual([]);
  });

  test("accepts a valid shinheuh", () => {
    const card = baseUnit({ kind: "shinheuh", line: "backline", rank: undefined, positions: [] });
    expect(errorsFor(card)).toEqual([]);
  });

  test("accepts a valid landmark", () => {
    const card = baseUnit({
      kind: "landmark",
      rank: undefined,
      positions: [],
      rules: [{ type: "disable_passives", raw: "passives have no effect" }],
    });
    expect(errorsFor(card)).toEqual([]);
  });

  test("rejects malformed landmark rule metadata", () => {
    const errors = errorsFor(baseUnit({
      kind: "landmark",
      rank: undefined,
      positions: [],
      rules: [
        { type: "grant_global_trait", trait: "not a trait", raw: "bad trait" },
        { type: "grant_global_condition", condition: "not a condition", raw: "bad condition" },
        { type: "condition_stack_cap", cap: 0, raw: "bad cap" },
        { type: "prevent_equip", position: "not a position", raw: "bad position" },
      ],
    }));
    expect(errors).toEqual(expect.arrayContaining([
      'rules[0].trait: "not a trait" is not a valid trait',
      'rules[1].condition: "not a condition" is not a valid condition',
      "rules[2].cap: must be a positive integer",
      'rules[3].position: "not a position" is not a valid position (must be a main position or "chosen")',
    ]));
  });

  test("accepts a valid conduit", () => {
    const card = baseUnit({
      kind: "conduit",
      rank: undefined,
      positions: [],
      deckConstraints: [{ type: "unreachable", raw: "i am Unreachable" }],
    });
    expect(errorsFor(card)).toEqual([]);
  });
});

describe("card-validate cross-references (evolution stages)", () => {
  function entry(card, filename = `${card.name.toLowerCase().replace(/\s+/g, "_")}.yml`) {
    return { filename, relativePath: `data/cards/${filename}`, card };
  }

  function run(allCards) {
    const failuresByFile = new Map();
    validateCrossReferences(allCards, failuresByFile);
    return failuresByFile;
  }

  test("accepts a unit whose stage target exists", () => {
    const failures = run([
      entry({ type: "unit", name: "A Unit", evolve: ["when i am deployed"] }),
      entry({ type: "unit", name: "A Unit II", evolve: [] }),
    ]);
    expect(failures.size).toBe(0);
  });

  test("rejects an evolve target that does not exist", () => {
    const failures = run([
      entry({ type: "unit", name: "A Unit", evolve: ["when i am deployed"] }),
    ]);
    const errors = [...failures.values()].flat();
    expect(errors).toContain(`evolve: target card "A Unit II" does not exist`);
  });

  test("rejects an evolve target that is not a unit", () => {
    const failures = run([
      entry({ type: "unit", name: "A Unit", evolve: ["when i am deployed"] }),
      entry({ type: "skill", name: "A Unit II", cost: 1, effects: [] }),
    ]);
    const errors = [...failures.values()].flat();
    expect(errors).toContain(`evolve: target card "A Unit II" does not exist`);
  });

  test("rejects a stage-marked unit whose parent does not exist", () => {
    const failures = run([
      entry({ type: "unit", name: "A Unit II", evolve: [] }),
    ]);
    const errors = [...failures.values()].flat();
    expect(errors).toContain(
      `name: "A Unit II" carries an evolution stage marker but "A Unit" does not exist`
    );
  });

  test("rejects duplicate card names", () => {
    const failures = run([
      entry({ type: "unit", name: "A Unit", evolve: [] }, "a.yml"),
      entry({ type: "unit", name: "A Unit", evolve: [] }, "a_copy.yml"),
    ]);
    const errors = [...failures.values()].flat();
    expect(errors.some((e) => e.includes(`duplicate card name "A Unit"`))).toBe(true);
  });
});
