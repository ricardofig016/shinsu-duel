import dslCatalog from "../../../../schemas/dsl-catalog.json" with { type: "json" };
import sourceSchema from "../../../../schemas/card.schema.json" with { type: "json" };
import compiledSchema from "../../../../schemas/compiled-cards.schema.json" with { type: "json" };

import { compileNode } from "../../../../scripts/card-compile.js";

// The catalog is the canonical DSL inventory; the two JSON Schemas stay
// explicit, hand-edited files. These tests are the coupling: any discriminator
// added to or removed from one contract without the other fails here, naming
// the stale contract and value.

const NODE_CATEGORIES = ["structural", "markers", "effects", "modifiers", "rules"];

const catalog = (category) => dslCatalog[category];
const nodeTypes = () => NODE_CATEGORIES.flatMap(catalog);
const sorted = (values) => [...values].sort();

const enumOf = (schema, definition, property = "type") =>
  schema.definitions[definition].properties[property].enum;

const predicateTypes = (schema) =>
  schema.definitions.predicate.oneOf.map((branch) => branch.properties.type.const);

/**
 * Set equality with a diff that names the two sides, so a drift failure says
 * which contract is stale and which values went missing or appeared.
 */
function expectSameSet(actual, expected, message) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);
  const missing = expectedSorted.filter((value) => !actualSorted.includes(value));
  const unexpected = actualSorted.filter((value) => !expectedSorted.includes(value));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${message}\n  missing from actual: [${missing.join(", ")}]\n  unexpected in actual: [${unexpected.join(", ")}]`
    );
  }
  expect(actualSorted).toEqual(expectedSorted);
}

describe("DSL catalog contract", () => {
  test("every catalog category is a non-empty list of unique strings", () => {
    const problems = [];
    for (const category of [...NODE_CATEGORIES, "predicates", "triggers", "deckConstraints"]) {
      const types = catalog(category);
      if (!Array.isArray(types) || types.length === 0) {
        problems.push(`${category} must be a non-empty array`);
        continue;
      }
      if (!types.every((type) => typeof type === "string" && type.length > 0)) {
        problems.push(`${category} entries must be non-empty strings`);
      }
      if (new Set(types).size !== types.length) {
        problems.push(`${category} contains duplicates`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("node categories do not overlap", () => {
    const seen = new Map();
    const problems = [];
    for (const category of NODE_CATEGORIES) {
      for (const type of catalog(category)) {
        if (seen.has(type)) {
          problems.push(`"${type}" appears in both ${seen.get(type)} and ${category}`);
        }
        seen.set(type, category);
      }
    }
    expect(problems).toEqual([]);
  });

  test("catalog ownership descriptions cover every category", () => {
    const missing = [...NODE_CATEGORIES, "predicates", "triggers", "deckConstraints"]
      .filter((category) => typeof dslCatalog.ownership[category] !== "string"
        || dslCatalog.ownership[category].length === 0);
    expect(missing).toEqual([]);
  });

  test("source schema effectNode enum matches structural, marker, and effect types", () => {
    expectSameSet(
      enumOf(sourceSchema, "effectNode"),
      [...catalog("structural"), ...catalog("markers"), ...catalog("effects")],
      "schemas/card.schema.json effectNode enum and the catalog structural/markers/effects categories disagree"
    );
  });

  test("compiled schema effectNode enum matches structural, marker, and effect types", () => {
    expectSameSet(
      enumOf(compiledSchema, "effectNode"),
      [...catalog("structural"), ...catalog("markers"), ...catalog("effects")],
      "schemas/compiled-cards.schema.json effectNode enum and the catalog structural/markers/effects categories disagree"
    );
  });

  test("both schemas together cover the full catalog node union exactly", () => {
    // The node vocabulary is split across three schema definitions
    // (effectNode, modifierNode, ruleNode); jointly they must accept exactly
    // the catalog's node types.
    for (const schema of [sourceSchema, compiledSchema]) {
      const name = schema === sourceSchema ? "source" : "compiled";
      const vocabulary = [
        ...enumOf(schema, "effectNode"),
        ...enumOf(schema, "modifierNode"),
        ...enumOf(schema, "ruleNode"),
      ];
      expectSameSet(
        vocabulary,
        nodeTypes(),
        `${name} schema node vocabulary (effectNode + modifierNode + ruleNode) disagrees with the catalog node union`
      );
    }
  });

  test("both schemas agree with the catalog on the modifier vocabulary", () => {
    expectSameSet(
      enumOf(sourceSchema, "modifierNode"),
      catalog("modifiers"),
      "source schema modifierNode enum disagrees with the catalog modifiers"
    );
    expectSameSet(
      enumOf(compiledSchema, "modifierNode"),
      catalog("modifiers"),
      "compiled schema modifierNode enum disagrees with the catalog modifiers"
    );
  });

  test("both schemas agree with the catalog on the landmark rule vocabulary", () => {
    expectSameSet(
      enumOf(sourceSchema, "ruleNode"),
      catalog("rules"),
      "source schema ruleNode enum disagrees with the catalog rules"
    );
    expectSameSet(
      enumOf(compiledSchema, "ruleNode"),
      catalog("rules"),
      "compiled schema ruleNode enum disagrees with the catalog rules"
    );
  });

  test("both schemas agree with the catalog on the trigger vocabulary", () => {
    expectSameSet(
      enumOf(sourceSchema, "trigger"),
      catalog("triggers"),
      "source schema trigger enum disagrees with the catalog triggers"
    );
    expectSameSet(
      enumOf(compiledSchema, "trigger"),
      catalog("triggers"),
      "compiled schema trigger enum disagrees with the catalog triggers"
    );
  });

  test("both schemas agree with the catalog on the predicate vocabulary", () => {
    expectSameSet(
      predicateTypes(sourceSchema),
      catalog("predicates"),
      "source schema predicate branches disagree with the catalog predicates"
    );
    expectSameSet(
      predicateTypes(compiledSchema),
      catalog("predicates"),
      "compiled schema predicate branches disagree with the catalog predicates"
    );
  });

  test("both schemas agree with the catalog on the deck constraint vocabulary", () => {
    expectSameSet(
      enumOf(sourceSchema, "deckConstraint"),
      catalog("deckConstraints"),
      "source schema deckConstraint enum disagrees with the catalog deckConstraints"
    );
    expectSameSet(
      enumOf(compiledSchema, "deckConstraint"),
      catalog("deckConstraints"),
      "compiled schema deckConstraint enum disagrees with the catalog deckConstraints"
    );
  });

  test("the compiler recognizes every catalog node type and nothing else", () => {
    // Recognition completeness: every cataloged type compiles…
    for (const type of nodeTypes()) {
      expect(() => compileNode({ type, raw: "test" }, "card.effects[0]")).not.toThrow();
    }
    // …and a type outside every catalog category is refused at its path.
    expect(() => compileNode({ type: "definitely_not_cataloged", raw: "test" }, "card.effects[0]"))
      .toThrow('card.effects[0]: unknown node type "definitely_not_cataloged"');
  });
});
