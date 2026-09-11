import fs from "node:fs";
import {
  buildDeckComposition,
  buildDeckCompositionLabel,
  buildDeckFan,
  buildDeckTableRow,
  compareDecks,
  deckAverageCost,
  deckFanTransforms,
  deckMatchesCardCriteria,
  DECK_SORT_KEYS,
  DECK_TABLE_COLUMNS,
} from "../../pages/decks/deck-view-models.js";

const entry = (slug, name, cost, type, affiliations = []) => {
  const view = { cardId: 1, slug, name, cost, type, affiliations: affiliations.map((code) => ({ name: code })) };
  return { view, slug, name, cost, type, isTest: false, deckEligible: true, marks: [] };
};

const entriesBySlug = new Map([
  ["ashen_knight", entry("ashen_knight", "Ashen Knight", 7, "unit", ["fug"])],
  ["brawn_idol", entry("brawn_idol", "Brawn Idol", 5, "unit", ["fug"])],
  ["cinder_skill", entry("cinder_skill", "Cinder Skill", 2, "skill")],
  ["dusty_armor", entry("dusty_armor", "Dusty Armor", 1, "equipment")],
  ["edgy_unit", entry("edgy_unit", "Edgy Unit", 5, "unit", ["wolhaiksong"])],
]);

describe("buildDeckFan", () => {
  test("shows the three most expensive distinct units, cheapest first", () => {
    const fan = buildDeckFan(["ashen_knight", "brawn_idol", "cinder_skill", "edgy_unit"], entriesBySlug);
    expect(fan.map((entry) => entry.slug)).toEqual(["edgy_unit", "brawn_idol", "ashen_knight"]);
  });

  test("ignores non-unit cards and slugs missing from the pool", () => {
    expect(buildDeckFan(["cinder_skill", "dusty_armor", "not_in_pool"], entriesBySlug)).toEqual([]);
  });

  test("collapses copies of the same card", () => {
    expect(buildDeckFan(["ashen_knight", "ashen_knight", "ashen_knight"], entriesBySlug).map((entry) => entry.slug)).toEqual(["ashen_knight"]);
  });

  test("honors the limit option", () => {
    expect(
      buildDeckFan(["ashen_knight", "brawn_idol", "cinder_skill", "edgy_unit"], entriesBySlug, { limit: 2 }).map((entry) => entry.slug)
    ).toEqual(["brawn_idol", "ashen_knight"]);
  });
});

describe("buildDeckComposition", () => {
  test("counts copies per type and unknown slugs as other", () => {
    const composition = buildDeckComposition(
      ["ashen_knight", "ashen_knight", "cinder_skill", "cinder_skill", "cinder_skill", "dusty_armor", "not_in_pool"],
      entriesBySlug
    );
    expect(composition).toEqual({ unit: 2, skill: 3, equipment: 1, other: 1 });
    expect(buildDeckCompositionLabel(composition)).toBe("2 / 3 / 1");
  });
});

describe("deckAverageCost", () => {
  test("averages card costs over copies", () => {
    expect(deckAverageCost(["ashen_knight", "cinder_skill"], entriesBySlug)).toBe(4.5);
    expect(deckAverageCost(["dusty_armor", "dusty_armor", "cinder_skill"], entriesBySlug)).toBe(1.3);
  });

  test("is null for an empty deck", () => {
    expect(deckAverageCost([], entriesBySlug)).toBeNull();
  });
});

describe("deckMatchesCardCriteria", () => {
  test("matches deck text through any card", () => {
    expect(deckMatchesCardCriteria(["ashen_knight"], entriesBySlug, { text: "ashen" })).toBe(true);
    expect(deckMatchesCardCriteria(["cinder_skill"], entriesBySlug, { text: "ashen" })).toBe(false);
  });

  test("matches type and affiliation facets independently", () => {
    expect(deckMatchesCardCriteria(["cinder_skill"], entriesBySlug, { type: "skill" })).toBe(true);
    expect(deckMatchesCardCriteria(["dusty_armor"], entriesBySlug, { type: "skill" })).toBe(false);
    expect(deckMatchesCardCriteria(["ashen_knight"], entriesBySlug, { affiliations: ["fug"] })).toBe(true);
    expect(deckMatchesCardCriteria(["edgy_unit"], entriesBySlug, { affiliations: ["fug"] })).toBe(false);
  });

  test("each active facet is satisfied by some card, not one single card", () => {
    const criteria = { type: "skill", affiliations: ["wolhaiksong"] };
    expect(deckMatchesCardCriteria(["cinder_skill", "edgy_unit"], entriesBySlug, criteria)).toBe(true);
    expect(deckMatchesCardCriteria(["ashen_knight", "cinder_skill"], entriesBySlug, criteria)).toBe(false);
  });

  test("slugs missing from the pool match nothing", () => {
    expect(deckMatchesCardCriteria(["not_in_pool"], entriesBySlug, { text: "ashen" })).toBe(false);
    expect(deckMatchesCardCriteria(["not_in_pool"], entriesBySlug, { affiliations: ["fug"] })).toBe(false);
  });
});

describe("compareDecks", () => {
  const decks = [
    { id: "b", name: "Beta", cardCount: 30 },
    { id: "a", name: "Alpha", cardCount: 10 },
    { id: "c", name: "Alpha", cardCount: 20 },
  ];

  test("supports name and size ordering with id tie-breaks", () => {
    for (const { key, expected } of [
      { key: "name-asc", expected: ["a", "c", "b"] },
      { key: "name-desc", expected: ["b", "a", "c"] },
      { key: "size-asc", expected: ["a", "c", "b"] },
      { key: "size-desc", expected: ["b", "c", "a"] },
    ]) {
      expect([...decks].sort(compareDecks(key)).map((deck) => deck.id)).toEqual(expected);
    }
  });

  test("exposes its keys with name ascending as the first entry", () => {
    expect(DECK_SORT_KEYS[0]).toEqual({ key: "name-asc", label: "Name A-Z" });
  });
});

describe("deckFanTransforms", () => {
  test("spreads three cards around the center with the last card frontmost", () => {
    const transforms = deckFanTransforms(3);

    expect(transforms.map((t) => t.zIndex)).toEqual([1, 2, 3]);
    expect(transforms[1]).toEqual({
      transform: "translateX(calc(-50% + 0rem)) rotate(0deg) scale(0.73)",
      zIndex: 2,
    });
    expect(transforms[2].transform).toContain("rotate(14deg) scale(0.73)");
    expect(transforms[0].transform).toContain("rotate(-14deg)");
  });

  test("centers a single card and emits nothing for an empty fan", () => {
    expect(deckFanTransforms(1)[0]).toEqual({
      transform: "translateX(calc(-50% + 0rem)) rotate(0deg) scale(0.73)",
      zIndex: 1,
    });
    expect(deckFanTransforms(0)).toEqual([]);
  });

  test("honors the spread option", () => {
    const transforms = deckFanTransforms(2, { spreadRem: 4 });
    expect(transforms[0].transform).toContain("-50% + -2rem");
    expect(transforms[1].transform).toContain("-50% + 2rem");
  });
});

describe("DECK_TABLE_COLUMNS", () => {
  test("opens with the fan and closes with the actions", () => {
    expect(DECK_TABLE_COLUMNS[0].key).toBe("fan");
    expect(DECK_TABLE_COLUMNS[DECK_TABLE_COLUMNS.length - 1].key).toBe("actions");
  });

  test("keys are unique and every column carries a header label", () => {
    expect(new Set(DECK_TABLE_COLUMNS.map((column) => column.key)).size).toBe(DECK_TABLE_COLUMNS.length);
    for (const column of DECK_TABLE_COLUMNS) {
      expect(typeof column.label).toBe("string");
      expect(column.label.length).toBeGreaterThan(0);
    }
  });

  test("every data column exists on the built row", () => {
    const row = buildDeckTableRow(
      {
        id: "d",
        name: "N",
        cards: ["ashen_knight"],
        legal: true,
        problems: [],
        updatedAt: "2025-01-02T00:00:00.000Z",
      },
      { entriesBySlug, limits: { deckSize: 30, maxCardCopies: 3, maxNameLength: 40 } }
    );

    // Map each column to the row field its cell renders; actions are buttons.
    const rowFields = {
      fan: "fan",
      name: "name",
      size: "sizeLabel",
      composition: "compositionLabel",
      averageCost: "averageCostLabel",
      status: "label",
      updatedAt: "updatedAtLabel",
    };
    for (const column of DECK_TABLE_COLUMNS) {
      if (column.key === "actions") continue;
      expect({ column: column.key, value: row[rowFields[column.key]] }).toEqual({
        column: column.key,
        value: expect.anything(),
      });
    }
  });

  test("the page header is generated from the columns, not hand-written", () => {
    const html = fs.readFileSync("public/pages/decks/index.html", "utf8");

    expect(html).toContain('id="decks-table-header-row"');
    expect(html).not.toMatch(/<th[\s>]/); // hand-written headers are how rows and columns drift apart
  });
});

describe("buildDeckTableRow", () => {
  test("extends the collection row with fan, composition, cost, and update stamp", () => {
    const row = buildDeckTableRow(
      {
        id: "deck1",
        name: "Wave Control",
        cards: ["ashen_knight", "ashen_knight", "cinder_skill"],
        legal: false,
        problems: ["A deck must contain exactly 30 cards; this one has 3."],
        updatedAt: "2025-01-02T03:04:05.000Z",
      },
      { entriesBySlug, limits: { deckSize: 30, maxCardCopies: 3, maxNameLength: 40 } }
    );

    expect(row).toMatchObject({
      id: "deck1",
      name: "Wave Control",
      sizeLabel: "3 / 30 cards",
      isLegal: false,
      compositionLabel: "2 / 1 / 0",
      averageCostLabel: "5.3",
      updatedAtLabel: "2025-01-02",
      fan: [expect.objectContaining({ slug: "ashen_knight" })],
    });
  });
});
