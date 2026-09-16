import { assembleDetailRow, relationTag, RELATION_TAGS } from "../../utils/card-detail-row.js";
import { buildCardViewModel } from "../../game/viewModels.js";

// Catalog views shaped like `Card.toSanitizedObject()` payloads; the row
// resolves them through `buildCardViewModel`.
const catalogView = (cardId, name, extras = {}) => ({
  cardId,
  type: "unit",
  name,
  ...extras,
});

const catalogIndex = {
  byId: new Map(
    [1, 2, 3, 4, 5, 6, 7].map((cardId) => [cardId, catalogView(cardId, `Card ${cardId}`)])
  ),
  // Attachment lookups key names like `buildCatalogIndex` does: lowercased.
  byName: new Map([
    ["heavy weights", catalogView(6, "Heavy Weights", { type: "equipment" })],
    ["sharpened blade", catalogView(7, "Sharpened Blade", { type: "equipment" })],
  ]),
};

describe("relationTag", () => {
  test("maps every relation kind to its tag text", () => {
    expect(relationTag({ kind: "evolution" })).toBe("Evolves from");
    expect(relationTag({ kind: "ignition" })).toBe("Ignited");
    expect(relationTag({ kind: "mention" })).toBe("Mentions this");
    expect(relationTag({ kind: "mentioned-by" })).toBe("Mentioned in");
    expect(relationTag({ kind: "series", seriesCode: "incinerate" })).toBe("Series: incinerate");
    expect(relationTag({ kind: "equipment" })).toBe("Equipment");
  });

  test("exposes the plain kind tags for lookup", () => {
    expect(RELATION_TAGS["mention"]).toBe("Mentions this");
  });
});

describe("assembleDetailRow", () => {
  const focus = buildCardViewModel({
    cardId: 1,
    type: "unit",
    name: "Focus",
    series: "incinerate",
    relatedCards: [
      { cardId: 2, kind: "evolution" },
      { cardId: 3, kind: "mention" },
      { cardId: 6, kind: "mention" }, // also attached: stays in the equipment column
      { cardId: 4, kind: "series" },
    ],
  });

  test("orders attached equipment left, then the focus, then related cards", () => {
    const unit = {
      ...focus,
      equipmentAttachments: ["Heavy Weights"],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.left.map((entry) => entry.card.cardId)).toEqual([6]);
    expect(row.right.map((entry) => entry.card.cardId)).toEqual([2, 3, 4]);
    expect(row.focusIndex).toBe(1);
  });

  test("folds each attachment's own related cards into the right list", () => {
    const equipment = {
      ...catalogView(6, "Heavy Weights", { type: "equipment" }),
      series: "weights",
      relatedCards: [
        { cardId: 3, kind: "mention" }, // already related by the focus: skipped
        { cardId: 5, kind: "mentioned-by" },
      ],
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map(catalogIndex.byName),
    };
    index.byId.set(6, equipment);
    index.byName.set("heavy weights", equipment);

    const unit = { ...focus, equipmentAttachments: ["Heavy Weights"] };
    const row = assembleDetailRow(unit, index);

    expect(row.right.map((entry) => [entry.card.cardId, entry.kind])).toEqual([
      [2, "evolution"],
      [3, "mention"],
      [4, "series"],
      [5, "mentioned-by"],
    ]);
  });

  test("tags series entries with the code of the card whose closure produced them", () => {
    const weights = {
      ...catalogView(6, "Heavy Weights", { type: "equipment" }),
      series: "weights",
      relatedCards: [{ cardId: 5, kind: "series" }],
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map([["heavy weights", weights]]),
    };

    const unit = { ...focus, relatedCards: [], equipmentAttachments: ["Heavy Weights"] };
    const row = assembleDetailRow(unit, index);

    expect(row.right.map((entry) => relationTag(entry))).toEqual(["Series: weights"]);
  });

  test("never repeats a card and keeps the first edge's position", () => {
    const unit = {
      ...focus,
      equipmentAttachments: ["Heavy Weights", "Sharpened Blade"],
    };
    const sharpened = {
      ...catalogView(7, "Sharpened Blade", { type: "equipment" }),
      relatedCards: [{ cardId: 2, kind: "mention" }], // focus already relates to 2
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map([
        ["heavy weights", catalogIndex.byName.get("heavy weights")],
        ["sharpened blade", sharpened],
      ]),
    };

    const row = assembleDetailRow(unit, index);
    const ids = [...row.left, ...row.right].map((entry) => entry.card.cardId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(1); // the focus never repeats
  });

  test("entries resolve to flattened card view models", () => {
    const unit = { ...focus, equipmentAttachments: ["Heavy Weights"] };
    const row = assembleDetailRow(unit, catalogIndex);

    for (const entry of [...row.left, ...row.right]) {
      expect(Array.isArray(entry.card.abilities)).toBe(true); // flattened shape
      expect(entry.card.cardId).toEqual(expect.any(Number));
    }
    expect(row.left[0].card.name).toBe("Heavy Weights");
    expect(row.right[0].card.name).toBe("Card 2");
  });

  test("degrades without a catalog: focus only", () => {
    const row = assembleDetailRow(focus, null);

    expect(row.left).toEqual([]);
    expect(row.right).toEqual([]);
    expect(row.focusIndex).toBe(0);
  });

  test("unresolvable relations and attachments contribute nothing", () => {
    const unit = {
      ...focus,
      relatedCards: [{ cardId: 99, kind: "mention" }],
      equipmentAttachments: ["Not In Catalog"],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.left).toEqual([]);
    expect(row.right).toEqual([]);
  });
});
