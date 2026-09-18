import Ajv from "ajv";

import compiledSchema from "../../../../schemas/compiled-cards.schema.json" with { type: "json" };
import positions from "../../../data/positions.json" with { type: "json" };
import traits from "../../../data/traits.json" with { type: "json" };
import affiliations from "../../../data/affiliations.json" with { type: "json" };
import attributes from "../../../data/attributes.json" with { type: "json" };
import catalogCopy from "./catalog-copy.json" with { type: "json" };
import shippedCatalogCopy from "../../../data/compiled/catalog-copy.json" with { type: "json" };

import { cards, byName } from "./cards.js";
import { FILLER_START, FILLER_COUNT, NAMED_ID_START } from "../../../../scripts/compile-fixtures.js";

/** Nested `{ [key]: value }` shape, used to compare catalog artifacts. */
function shapeOf(value) {
  if (Array.isArray(value)) return value.map(shapeOf);
  if (!value || typeof value !== "object") return typeof value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, shapeOf(value[key])]));
}

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

  test("text links compile into segments and stamp recursive relations", () => {
    const burner = cards[byName["test burn passive unit"]];
    const damageSkill = cards[byName["test damage skill"]];

    // The passive's authored text tokenized into display segments.
    const passive = burner.passives[0];
    expect(passive.text).toEqual([
      { type: "card", ref: "test_damage_skill", text: "Test Damage Skill" },
      " gives ",
      { type: "condition", ref: "burned", text: "Burned" },
      " 1",
    ]);

    // The card link stamps a mention; the skill sees it in reverse. The
    // condition link names no card, so it contributes no relation.
    expect(burner.relatedCards).toContainEqual({
      cardId: damageSkill.cardId,
      kind: "mentioned-in",
      peerCardId: burner.cardId,
    });
    expect(damageSkill.relatedCards).toContainEqual({
      cardId: burner.cardId,
      kind: "mentions",
      peerCardId: damageSkill.cardId,
    });
  });

  test("no fixture uses `custom` or `handler` DSL", () => {
    expect(JSON.stringify(cards)).not.toContain('"custom"');
    expect(JSON.stringify(cards)).not.toContain('"handler"');
  });

  test("the fixture shared-catalog copy mirrors the shipped copy field for field", () => {
    // The fixture artifact is compiled by its own run, but it compiles the
    // same authoring catalogs. A display path must never find a field that
    // exists only in one of the two.
    expect(shapeOf(catalogCopy)).toEqual(shapeOf(shippedCatalogCopy));
  });

  test("inherited catalog mentions reach the cards that carry or name the copy", () => {
    // The fixtures carry a Hwayeomsa attribute and a card targeting one; the
    // copy those name (the Hwayeomsa effect line) names Fire Core, so every
    // such card relates to the fixture's Fire Core with itself as the peer.
    const fireCore = cards[byName["fire core"]];
    expect(fireCore).toBeDefined();

    const carriers = Object.values(cards).filter((card) =>
      card.relatedCards?.some(
        (entry) => entry.cardId === fireCore.cardId && entry.kind === "mentioned-in" && entry.peerCardId === card.cardId
      )
    );
    expect(carriers.length).toBeGreaterThan(0);
    expect(fireCore.relatedCards).toEqual(
      expect.arrayContaining(carriers.map((card) => ({ cardId: card.cardId, kind: "mentions", peerCardId: fireCore.cardId })))
    );
  });
});
