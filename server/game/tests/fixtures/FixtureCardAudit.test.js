import Ajv from "ajv";

import compiledSchema from "../../../../schemas/compiled-cards.schema.json" with { type: "json" };
import positions from "../../../data/positions.json" with { type: "json" };
import traits from "../../../data/traits.json" with { type: "json" };
import affiliations from "../../../data/affiliations.json" with { type: "json" };
import attributes from "../../../data/attributes.json" with { type: "json" };

import { cards, byName } from "./cards.js";
import { FILLER_START, FILLER_COUNT, NAMED_ID_START } from "../../../../scripts/compile-fixtures.js";

describe("fixture card audit (contract coupling only)", () => {
  test("fixtures validate against the compiled schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(compiledSchema);
    const valid = validate(cards);
    expect(validate.errors ?? null).toBeNull();
    expect(valid).toBe(true);
  });

  test("fixture ids and names are unique", () => {
    const entries = Object.values(cards);
    const ids = entries.map((c) => c.cardId);
    const names = entries.map((c) => c.name.toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
    expect(Object.keys(byName).length).toBe(entries.length);
  });

  test("generic fillers occupy the lowest ids (1..40)", () => {
    const entries = Object.values(cards);
    const fillers = entries.filter(
      (card) => card.cardId >= FILLER_START && card.cardId < FILLER_START + FILLER_COUNT
    );
    expect(fillers).toHaveLength(FILLER_COUNT);
    for (const card of fillers) {
      expect(card.name).toMatch(/^Test Filler \d+$/);
    }
    const named = entries.filter((card) => card.cardId >= NAMED_ID_START);
    expect(named.length).toBeGreaterThan(0);
    expect(Math.max(...fillers.map((card) => card.cardId))).toBeLessThan(
      Math.min(...named.map((card) => card.cardId))
    );
  });

  test("named fixtures use compiler-assigned ids (10000+) with no gap ids", () => {
    const entries = Object.values(cards);
    expect(entries.length).toBeGreaterThan(FILLER_COUNT);
    for (const card of entries) {
      const isFiller = card.cardId >= FILLER_START && card.cardId < FILLER_START + FILLER_COUNT;
      const isNamed = card.cardId >= NAMED_ID_START;
      expect(isFiller || isNamed).toBe(true);
    }
  });

  test("fixture catalog codes resolve against the shipped catalog vocabulary", () => {
    for (const card of Object.values(cards)) {
      for (const code of card.positions ?? []) {
        expect(positions[code]).toBeDefined();
      }
      for (const trait of card.traits ?? []) {
        expect(traits[trait.code]).toBeDefined();
      }
      for (const code of card.affiliations ?? []) {
        expect(affiliations[code]).toBeDefined();
      }
      for (const code of card.attributes ?? []) {
        expect(attributes[code]).toBeDefined();
      }
    }
  });

  test("at least 30 eligible cards exist for legal deck construction", () => {
    const eligible = Object.values(cards).filter(
      (card) => !(card.deckConstraints || []).some((c) => c.type === "unreachable")
    );
    expect(eligible.length).toBeGreaterThanOrEqual(30);
  });

  test("transformation cross-references point at real fixture ids", () => {
    for (const card of Object.values(cards)) {
      if (card.evolveInto) expect(cards[card.evolveInto.cardId]).toBeDefined();
      if (card.igniteInto) expect(cards[card.igniteInto.cardId]).toBeDefined();
      if (card.evolvedFrom !== undefined) expect(cards[card.evolvedFrom]).toBeDefined();
      if (card.ignitedFrom !== undefined) expect(cards[card.ignitedFrom]).toBeDefined();
    }
  });

  test("no fixture uses `custom` or `handler` DSL", () => {
    expect(JSON.stringify(cards)).not.toContain('"custom"');
    expect(JSON.stringify(cards)).not.toContain('"handler"');
  });
});
