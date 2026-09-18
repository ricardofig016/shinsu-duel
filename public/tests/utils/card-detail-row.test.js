import { assembleDetailRow, relationTag, seriesDisplayName, RELATION_TAGS } from "../../utils/card-detail-row.js";
import { buildCardViewModel } from "../../game/viewModels.js";

// Catalog views shaped like `Card.toSanitizedObject()` payloads; the row
// resolves them through `buildCardViewModel`.
const catalogView = (cardId, name, extras = {}) => ({
  cardId,
  type: "unit",
  name,
  ...extras,
});

const heavyWeights = catalogView(6, "Heavy Weights", { type: "equipment" });
const sharpenedBlade = catalogView(7, "Sharpened Blade", { type: "equipment" });

const catalogIndex = {
  byId: new Map([
    ...[1, 2, 3, 4, 5].map((cardId) => [cardId, catalogView(cardId, `Card ${cardId}`)]),
    [6, heavyWeights],
    [7, sharpenedBlade],
  ]),
  // Attachment lookups key names like `buildCatalogIndex` does: lowercased.
  byName: new Map([
    ["heavy weights", heavyWeights],
    ["sharpened blade", sharpenedBlade],
  ]),
};

describe("seriesDisplayName", () => {
  test("turns a dash-cased series code into its display name", () => {
    expect(seriesDisplayName("jeonsul-baang")).toBe("Jeonsul Baang");
    expect(seriesDisplayName("thorn-fragment")).toBe("Thorn Fragment");
    expect(seriesDisplayName("")).toBe("");
    expect(seriesDisplayName(null)).toBe("");
  });
});

describe("relationTag", () => {
  test("maps every relation kind to its tag text", () => {
    expect(relationTag({ kind: "evolves-into", peerName: "Beta II" })).toBe("Evolves into Beta II");
    expect(relationTag({ kind: "evolves-from", peerName: "Beta" })).toBe("Evolves from Beta");
    expect(relationTag({ kind: "ignites-into", peerName: "Narumada - Ignited" })).toBe("Ignites into Narumada - Ignited");
    expect(relationTag({ kind: "ignited-from", peerName: "Narumada" })).toBe("Ignited from Narumada");
    expect(relationTag({ kind: "mentions", peerName: "Baang" })).toBe("Mentions Baang");
    expect(relationTag({ kind: "mentioned-in", peerName: "Conduit" })).toBe("Mentioned in Conduit");
    expect(relationTag({ kind: "series-mentioned", seriesCode: "jeonsul-baang", peerName: "Conduit" }))
      .toBe("Jeonsul Baang series mentioned by Conduit");
    expect(relationTag({ kind: "same-series-as", peerName: "Lightning Baang" })).toBe("Same series as Lightning Baang");
    expect(relationTag({ kind: "equipment", focusName: "Khun Ran" })).toBe("Equipped to Khun Ran");
  });

  test("renders nothing for an unknown kind or an unresolved name", () => {
    expect(relationTag({ kind: "custom", peerName: "Card 2" })).toBe("");
    expect(relationTag({ kind: "mentions" })).toBe("");
    expect(relationTag({ kind: "series-mentioned", peerName: "Conduit" })).toBe("");
    expect(relationTag({ kind: "equipment" })).toBe("");
    expect(relationTag(undefined)).toBe("");
  });

  test("exposes the tag templates keyed by kind", () => {
    expect(Object.keys(RELATION_TAGS).sort()).toEqual([
      "equipment",
      "evolves-from",
      "evolves-into",
      "ignited-from",
      "ignites-into",
      "mentioned-in",
      "mentions",
      "same-series-as",
      "series-mentioned",
    ]);
    expect(RELATION_TAGS.mentions({ peerName: "Baang" })).toBe("Mentions Baang");
  });
});

describe("assembleDetailRow", () => {
  const focus = buildCardViewModel({
    cardId: 1,
    type: "unit",
    name: "Focus",
    series: "incinerate",
    relatedCards: [
      { cardId: 2, kind: "evolves-from", peerCardId: 1 },
      { cardId: 3, kind: "mentioned-in", peerCardId: 1 },
      { cardId: 6, kind: "mentioned-in", peerCardId: 1 }, // also attached: stays in the equipment column
      { cardId: 4, kind: "same-series-as", peerCardId: 1, seriesCode: "incinerate" },
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
    expect(relationTag(row.left[0])).toBe("Equipped to Focus");
  });

  test("renders each related card's own directional tag, naming its peer", () => {
    const row = assembleDetailRow(focus, catalogIndex);

    expect(row.right.map((entry) => [entry.card.cardId, relationTag(entry)])).toEqual([
      [2, "Evolves from Focus"],
      [3, "Mentioned in Focus"],
      [6, "Mentioned in Focus"],
      [4, "Same series as Focus"],
    ]);
  });

  test("folds each attachment's own related cards into the right list", () => {
    const equipment = {
      ...heavyWeights,
      series: "weights",
      relatedCards: [
        { cardId: 3, kind: "mentioned-in", peerCardId: 6 }, // already related by the focus: skipped
        { cardId: 5, kind: "mentions", peerCardId: 6 },
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
      [2, "evolves-from"],
      [3, "mentioned-in"],
      [4, "same-series-as"],
      [5, "mentions"],
    ]);
    // The folded entry's peer is the attachment whose closure produced it.
    expect(relationTag(row.right[3])).toBe("Mentions Heavy Weights");
  });

  test("resolves each entry's peer to the focus, a row card, or an attachment", () => {
    const equipment = {
      ...heavyWeights,
      series: "weights",
      relatedCards: [{ cardId: 4, kind: "same-series-as", peerCardId: 6, seriesCode: "weights" }],
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map(catalogIndex.byName),
    };
    index.byId.set(6, equipment);
    index.byName.set("heavy weights", equipment);

    const unit = {
      ...focus,
      relatedCards: [
        { cardId: 2, kind: "mentions", peerCardId: 3 }, // peer is a row card
        { cardId: 5, kind: "mentions", peerCardId: 1 }, // peer is the focused model
      ],
      equipmentAttachments: ["Heavy Weights"],
    };
    const row = assembleDetailRow(unit, index);
    const byCardId = new Map(row.right.map((entry) => [entry.card.cardId, entry]));

    // The focused model may be a unit view, so its own name wins over the
    // catalog entry for the same cardId.
    expect(relationTag(byCardId.get(2))).toBe("Mentions Card 3");
    expect(relationTag(byCardId.get(5))).toBe("Mentions Focus");
    expect(relationTag(byCardId.get(4))).toBe("Same series as Heavy Weights");
  });

  test("tags series entries with the code carried by the stamp", () => {
    const weights = {
      ...heavyWeights,
      series: "weights",
      relatedCards: [{ cardId: 5, kind: "same-series-as", peerCardId: 6, seriesCode: "weights" }],
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map([["heavy weights", weights]]),
    };
    index.byId.set(6, weights);

    const unit = { ...focus, relatedCards: [], equipmentAttachments: ["Heavy Weights"] };
    const row = assembleDetailRow(unit, index);

    expect(row.right.map((entry) => relationTag(entry))).toEqual(["Same series as Heavy Weights"]);
  });

  test("never repeats a card and keeps the first edge's position", () => {
    const unit = {
      ...focus,
      equipmentAttachments: ["Heavy Weights", "Sharpened Blade"],
    };
    const sharpened = {
      ...sharpenedBlade,
      relatedCards: [{ cardId: 2, kind: "mentions", peerCardId: 7 }], // focus already relates to 2
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map([
        ["heavy weights", heavyWeights],
        ["sharpened blade", sharpened],
      ]),
    };
    index.byId.set(7, sharpened);

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
      relatedCards: [{ cardId: 99, kind: "mentioned-in", peerCardId: 1 }],
      equipmentAttachments: ["Not In Catalog"],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.left).toEqual([]);
    expect(row.right).toEqual([]);
  });

  test("a relation whose peer is not in the catalog still renders its card", () => {
    const unit = {
      ...focus,
      relatedCards: [{ cardId: 2, kind: "mentions", peerCardId: 99 }],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.right.map((entry) => relationTag(entry))).toEqual([""]);
  });
});
