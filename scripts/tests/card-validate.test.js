import { validateCard } from "../card-validate.js";

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
