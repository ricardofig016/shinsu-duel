import { parseArgs, legacyGetMatches, fieldValueGetMatches, fieldMatches } from "../scripts/card-lookup.js";

describe("card-lookup", () => {
  const sampleCard = {
    type: "unit",
    name: "Twenty-Fifth Baam",
    cost: 5,
    hp: 6,
    rank: "regular",
    positions: ["wave controller"],
    traits: ["barrier", "strong 10"],
    attributes: ["living ignition weapon", "irregular"],
    affiliations: ["team baam", "fug"],
    passives: "round start: create a thorn fragment",
    abilities: "create a Thorn Fragment of your choice in hand",
    effects: "",
    requirements: "",
  };

  describe("parseArgs", () => {
    test("single word query becomes global search", () => {
      const result = parseArgs(["living"]);
      expect(result.queries).toEqual([{ field: null, value: "living" }]);
    });

    test("multiple space-separated words join into one global query", () => {
      const result = parseArgs(["living", "ignition", "weapon"]);
      expect(result.queries).toEqual([{ field: null, value: "living ignition weapon" }]);
    });

    test("comma separates AND queries", () => {
      const result = parseArgs(["cost=3,type=unit"]);
      expect(result.queries).toEqual([
        { field: "cost", value: "3" },
        { field: "type", value: "unit" },
      ]);
    });

    test("space-joined phrase with comma creates two AND queries", () => {
      const result = parseArgs(["name=baam", ",", "cost=5"]);
      expect(result.queries).toEqual([
        { field: "name", value: "baam" },
        { field: "cost", value: "5" },
      ]);
    });

    test("field=value query", () => {
      const result = parseArgs(["attributes=living ignition weapon"]);
      expect(result.queries).toEqual([{ field: "attributes", value: "living ignition weapon" }]);
    });

    test("flags are parsed separately", () => {
      const result = parseArgs(["/dist", "baam"]);
      expect(result.dist).toBe(true);
      expect(result.queries).toEqual([{ field: null, value: "baam" }]);
    });

    test("/help flag", () => {
      const result = parseArgs(["/help"]);
      expect(result.help).toBe(true);
    });

    test("empty input", () => {
      const result = parseArgs([]);
      expect(result.queries).toEqual([]);
    });

    test("empty input yields no queries (empty strings are trimmed)", () => {
      const result = parseArgs([""]);
      expect(result.queries).toEqual([]);
    });
  });

  describe("legacyGetMatches", () => {
    test("global search finds match in scalar field", () => {
      const matches = legacyGetMatches(sampleCard, "baam");
      expect(matches.length).toBeGreaterThan(0);
      expect(matches.some((m) => m.field === "name")).toBe(true);
    });

    test("global search finds match in array field", () => {
      const matches = legacyGetMatches(sampleCard, "living");
      expect(matches.some((m) => m.field === "attributes")).toBe(true);
    });

    test("global search is case-insensitive", () => {
      const matches = legacyGetMatches(sampleCard, "TWENTY-FIFTH");
      expect(matches.some((m) => m.field === "name")).toBe(true);
    });

    test("global search with no match returns empty", () => {
      const matches = legacyGetMatches(sampleCard, "zzznotfound");
      expect(matches).toEqual([]);
    });
  });

  describe("fieldValueGetMatches", () => {
    test("field=value matches array elements via substring", () => {
      const matches = fieldValueGetMatches(sampleCard, "attributes", "living ignition weapon");
      expect(matches.length).toBe(1);
      expect(matches[0].field).toBe("attributes");
      expect(matches[0].values).toContain("living ignition weapon");
    });

    test("field=value matches single array element", () => {
      const matches = fieldValueGetMatches(sampleCard, "attributes", "irregular");
      expect(matches.length).toBe(1);
      expect(matches[0].values).toContain("irregular");
    });

    test("field=value does NOT match via array-to-string coercion", () => {
      // "living ignition weapon" alone should NOT match the full array string "living ignition weapon,irregular"
      const matches = fieldValueGetMatches(sampleCard, "attributes", "irregular");
      expect(matches.length).toBe(1);
      // The values returned should only contain the matched element, not the full array
      expect(matches[0].values.length).toBe(1);
      expect(matches[0].values[0]).toBe("irregular");
    });

    test("field=value exact match on scalar", () => {
      const matches = fieldValueGetMatches(sampleCard, "type", "unit");
      expect(matches.length).toBe(1);
      expect(matches[0].values).toEqual(["unit"]);
    });

    test("field=value wildcard matches non-empty array", () => {
      const matches = fieldValueGetMatches(sampleCard, "attributes", "*");
      expect(matches.length).toBe(1);
    });

    test("field=value no match returns empty", () => {
      const matches = fieldValueGetMatches(sampleCard, "type", "skill");
      expect(matches).toEqual([]);
    });

    test("field=value on missing field returns empty", () => {
      const matches = fieldValueGetMatches(sampleCard, "nonexistent", "foo");
      expect(matches).toEqual([]);
    });

    test("field=value on null field returns empty", () => {
      const card = { name: null };
      const matches = fieldValueGetMatches(card, "name", "foo");
      expect(matches).toEqual([]);
    });
  });

  describe("fieldMatches", () => {
    test("type is exact match", () => {
      expect(fieldMatches(sampleCard, "type", "unit")).toBe(true);
      expect(fieldMatches(sampleCard, "type", "skill")).toBe(false);
    });

    test("name is fuzzy match (ignoring spaces and special chars)", () => {
      expect(fieldMatches({ name: "Twenty-Fifth Baam" }, "name", "twentyfifth")).toBe(true);
      expect(fieldMatches({ name: "Jyu Viole Grace" }, "name", "jyuviole")).toBe(true);
    });

    test("cost supports range", () => {
      expect(fieldMatches(sampleCard, "cost", "3-7")).toBe(true);
      expect(fieldMatches(sampleCard, "cost", "6-10")).toBe(false);
    });

    test("cost supports exact match", () => {
      expect(fieldMatches(sampleCard, "cost", "5")).toBe(true);
    });
  });
});
