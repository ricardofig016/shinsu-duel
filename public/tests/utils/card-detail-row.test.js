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
  // A stamp mixing both tiers, so every assertion below can name the list an
  // entry belongs to and why.
  const focus = buildCardViewModel({
    cardId: 1,
    type: "unit",
    name: "Focus",
    series: "incinerate",
    relatedCards: [
      // primary: the focus's own copy names this card
      { cardId: 3, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      // primary: the focus grows into this card
      { cardId: 2, kind: "evolves-from", peerCardId: 1, tier: "primary" },
      // also attached: stays in the equipment column
      { cardId: 6, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      // secondary: this card shares the focus's series
      { cardId: 4, kind: "same-series-as", peerCardId: 1, seriesCode: "incinerate", tier: "secondary" },
    ],
  });

  test("orders attached equipment left, then the focus, then the primary related cards", () => {
    const unit = {
      ...focus,
      equipmentAttachments: ["Heavy Weights"],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.left.map((entry) => entry.card.cardId)).toEqual([6]);
    expect(row.right.map((entry) => entry.card.cardId)).toEqual([3, 2]);
    expect(row.more.map((entry) => entry.card.cardId)).toEqual([4]);
    expect(row.focusIndex).toBe(1);
    expect(relationTag(row.left[0])).toBe("Equipped to Focus");
  });

  test("renders each related card's own directional tag, naming its peer", () => {
    const row = assembleDetailRow(focus, catalogIndex);

    expect(row.right.map((entry) => [entry.card.cardId, relationTag(entry)])).toEqual([
      [3, "Mentioned in Focus"],
      [2, "Evolves from Focus"],
      [6, "Mentioned in Focus"],
    ]);
    expect(row.more.map((entry) => [entry.card.cardId, relationTag(entry)])).toEqual([
      [4, "Same series as Focus"],
    ]);
  });

  test("shows only the primary tier by default and hides the rest", () => {
    const row = assembleDetailRow(focus, catalogIndex);

    const shown = row.right.map((entry) => entry.card.cardId);
    const hidden = row.more.map((entry) => entry.card.cardId);
    // The two tiers never overlap: a card is revealed or it is on screen.
    expect(shown.filter((cardId) => hidden.includes(cardId))).toEqual([]);
    // Every related card the stamp carries is in exactly one of them.
    expect([...shown, ...hidden].sort()).toEqual([2, 3, 4, 6]);
  });

  test("a stamp with no secondary tier has nothing to reveal", () => {
    const primaryOnly = buildCardViewModel({
      cardId: 1,
      type: "unit",
      name: "Focus",
      relatedCards: [
        { cardId: 2, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
        { cardId: 3, kind: "series-mentioned", peerCardId: 1, seriesCode: "incinerate", tier: "primary" },
      ],
    });
    const row = assembleDetailRow(primaryOnly, catalogIndex);

    expect(row.right.map((entry) => entry.card.cardId)).toEqual([2, 3]);
    expect(row.more).toEqual([]);
  });

  test("a stamp with no primary tier shows nothing until the reveal", () => {
    const secondaryOnly = buildCardViewModel({
      cardId: 1,
      type: "unit",
      name: "Focus",
      relatedCards: [
        { cardId: 2, kind: "mentions", peerCardId: 1, tier: "secondary" },
        { cardId: 3, kind: "evolves-into", peerCardId: 1, tier: "secondary" },
      ],
    });
    const row = assembleDetailRow(secondaryOnly, catalogIndex);

    expect(row.right).toEqual([]);
    expect(row.more.map((entry) => entry.card.cardId)).toEqual([2, 3]);
  });

  test("a card whose relations are all secondary still has a row", () => {
    // Baang's shape in the shipped catalog: every related card names it or is
    // reached through one that does, so the row builder hands back nothing for
    // the owned tier and everything for the revealed one. The overlay renders
    // the focus and its button in that case, which is the shape that used to
    // throw while the overlay was opening.
    const namer = buildCardViewModel({
      cardId: 2,
      type: "unit",
      name: "Card 2",
      relatedCards: [{ cardId: 3, kind: "mentions", peerCardId: 2, tier: "secondary" }],
    });
    // a fresh index, because assembling a row consumes its `seen` set
    const index = {
      byId: new Map([...catalogIndex.byId, [2, namer]]),
      byName: new Map(catalogIndex.byName),
    };
    const focus = buildCardViewModel({
      cardId: 1,
      type: "unit",
      name: "Focus",
      relatedCards: [
        { cardId: 2, kind: "mentions", peerCardId: 1, tier: "secondary" },
        { cardId: 3, kind: "mentions", peerCardId: 1, tier: "secondary" },
      ],
    });

    const row = assembleDetailRow(focus, index);

    expect(row.right).toEqual([]);
    expect(row.more.map((entry) => entry.card.cardId)).toEqual([2, 3]);
    // the focus is the only owned card, so it is the whole row until the button
    // is pressed, and the row builder says so by putting it at the front
    expect(row.focusIndex).toBe(row.left.length);
    expect(row.left).toEqual([]);
  });

  test("an entry with no tier is held back rather than lost", () => {
    // A stamp written before the tier existed, or hand-edited without it, has
    // no claim to the default tier, but dropping it would lose a relation the
    // overlay used to show.
    const unstamped = buildCardViewModel({
      cardId: 1,
      type: "unit",
      name: "Focus",
      relatedCards: [{ cardId: 2, kind: "mentioned-in", peerCardId: 1 }],
    });
    const row = assembleDetailRow(unstamped, catalogIndex);

    expect(row.right).toEqual([]);
    expect(row.more.map((entry) => entry.card.cardId)).toEqual([2]);
  });

  test("an entry the primary tier dropped is claimable by a secondary edge", () => {
    const unit = {
      ...focus,
      relatedCards: [
        { cardId: 2, kind: "mentioned-in", peerCardId: 99, tier: "primary" }, // peer 99 is not in the catalog
        { cardId: 2, kind: "mentions", peerCardId: 1, tier: "secondary" }, // same card, a statable edge
        { cardId: 3, kind: "custom", peerCardId: 1, tier: "primary" }, // unknown kind
        { cardId: 4, kind: "series-mentioned", peerCardId: 1, tier: "secondary" }, // series entry with no series
        { cardId: 7, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      ],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    // 2 is claimed by its second, statable edge, which is secondary; 3 and 4
    // would sit in the row claiming nothing, so they are not shown at all.
    expect(row.right.map((entry) => entry.card.cardId)).toEqual([7]);
    expect(row.more.map((entry) => [entry.card.cardId, relationTag(entry)])).toEqual([
      [2, "Mentions Focus"],
    ]);
  });

  test("drops entries whose relation cannot be stated, letting a later edge claim the card", () => {
    const unit = {
      ...focus,
      relatedCards: [
        { cardId: 2, kind: "mentions", peerCardId: 99, tier: "secondary" }, // peer 99 is not in the catalog
        { cardId: 2, kind: "evolves-from", peerCardId: 1, tier: "primary" }, // same card, a statable edge
        { cardId: 3, kind: "custom", peerCardId: 1, tier: "primary" }, // unknown kind
        { cardId: 4, kind: "series-mentioned", peerCardId: 1, tier: "primary" }, // series entry with no series
        { cardId: 7, kind: "mentioned-in", peerCardId: 1, tier: "primary" },
      ],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    // 2 is claimed by its second, statable edge; 3 and 4 would sit in the row
    // claiming nothing, so they are not shown at all.
    expect(row.right.map((entry) => [entry.card.cardId, relationTag(entry)])).toEqual([
      [2, "Evolves from Focus"],
      [7, "Mentioned in Focus"],
    ]);
    expect(row.more).toEqual([]);
  });

  test("folds each attachment's own related cards into the right list", () => {
    const equipment = {
      ...heavyWeights,
      series: "weights",
      relatedCards: [
        { cardId: 3, kind: "mentioned-in", peerCardId: 6, tier: "primary" }, // already related by the focus: skipped
        { cardId: 5, kind: "mentions", peerCardId: 6, tier: "primary" },
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

    expect([...row.right, ...row.more].map((entry) => [entry.card.cardId, entry.kind])).toEqual([
      [3, "mentioned-in"],
      [2, "evolves-from"],
      [5, "mentions"],
      [4, "same-series-as"],
    ]);
    // The folded entry's peer is the attachment whose closure produced it.
    const folded = row.right.find((entry) => entry.card.cardId === 5);
    expect(relationTag(folded)).toBe("Mentions Heavy Weights");
  });

  test("tiers an attachment's own closure against the attachment, not the focus", () => {
    // An attachment is a second root of the relation tree. A card it names is
    // its primary relation even though it is two hops from the focus, so it
    // belongs in the default tier rather than behind the reveal.
    const equipment = {
      ...heavyWeights,
      series: "weights",
      relatedCards: [
        { cardId: 5, kind: "mentioned-in", peerCardId: 6, tier: "primary" },
        { cardId: 7, kind: "same-series-as", peerCardId: 6, seriesCode: "weights", tier: "secondary" },
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
    const right = row.right.map((entry) => entry.card.cardId);
    const more = row.more.map((entry) => entry.card.cardId);

    // 5 is primary because the attachment names it: two hops from the focus,
    // and still on screen. 7 is secondary because the attachment only shares a
    // series with it, and 4 is the focus's own secondary entry.
    expect(right).toContain(5);
    expect(more).not.toContain(5);
    expect(more).toContain(7);
    expect(right).not.toContain(7);
    expect(more).toContain(4);
    expect([...right, ...more].sort()).toEqual([2, 3, 4, 5, 7]);
  });

  test("resolves each entry's peer to the focus, a row card, or an attachment", () => {
    const equipment = {
      ...heavyWeights,
      series: "weights",
      relatedCards: [
        { cardId: 4, kind: "same-series-as", peerCardId: 6, seriesCode: "weights", tier: "secondary" },
      ],
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
        { cardId: 2, kind: "mentions", peerCardId: 3, tier: "primary" }, // peer is a row card
        { cardId: 5, kind: "mentions", peerCardId: 1, tier: "primary" }, // peer is the focused model
      ],
      equipmentAttachments: ["Heavy Weights"],
    };
    const row = assembleDetailRow(unit, index);
    const byCardId = new Map([...row.right, ...row.more].map((entry) => [entry.card.cardId, entry]));

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
      relatedCards: [
        { cardId: 5, kind: "same-series-as", peerCardId: 6, seriesCode: "weights", tier: "secondary" },
      ],
    };
    const index = {
      byId: new Map(catalogIndex.byId),
      byName: new Map([["heavy weights", weights]]),
    };
    index.byId.set(6, weights);

    const unit = { ...focus, relatedCards: [], equipmentAttachments: ["Heavy Weights"] };
    const row = assembleDetailRow(unit, index);

    expect(row.right).toEqual([]);
    expect(row.more.map((entry) => relationTag(entry))).toEqual(["Same series as Heavy Weights"]);
  });

  test("never repeats a card and keeps the first edge's position", () => {
    const unit = {
      ...focus,
      equipmentAttachments: ["Heavy Weights", "Sharpened Blade"],
    };
    const sharpened = {
      ...sharpenedBlade,
      relatedCards: [{ cardId: 2, kind: "mentions", peerCardId: 7, tier: "secondary" }], // focus already relates to 2
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
    const ids = [...row.left, ...row.right, ...row.more].map((entry) => entry.card.cardId);

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(1); // the focus never repeats
  });

  test("entries resolve to flattened card view models", () => {
    const unit = { ...focus, equipmentAttachments: ["Heavy Weights"] };
    const row = assembleDetailRow(unit, catalogIndex);

    for (const entry of [...row.left, ...row.right, ...row.more]) {
      expect(Array.isArray(entry.card.abilities)).toBe(true); // flattened shape
      expect(entry.card.cardId).toEqual(expect.any(Number));
    }
    expect(row.left[0].card.name).toBe("Heavy Weights");
    expect(row.right[0].card.name).toBe("Card 3");
  });

  test("degrades without a catalog: focus only", () => {
    const row = assembleDetailRow(focus, null);

    expect(row.left).toEqual([]);
    expect(row.right).toEqual([]);
    expect(row.more).toEqual([]);
    expect(row.focusIndex).toBe(0);
  });

  test("unresolvable relations and attachments contribute nothing", () => {
    const unit = {
      ...focus,
      relatedCards: [{ cardId: 99, kind: "mentioned-in", peerCardId: 1, tier: "primary" }],
      equipmentAttachments: ["Not In Catalog"],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.left).toEqual([]);
    expect(row.right).toEqual([]);
    expect(row.more).toEqual([]);
  });

  test("drops a relation whose peer is not in the catalog instead of showing it untagged", () => {
    // A peer the catalog cannot name leaves the tag empty, and a slot claiming
    // nothing is not a relation a player can read. This is the shape a
    // dev-only card's mention reached a real card's carousel in: the served
    // catalog filters dev cards out, so their id never resolves here.
    const unit = {
      ...focus,
      relatedCards: [{ cardId: 2, kind: "mentions", peerCardId: 99, tier: "secondary" }],
    };
    const row = assembleDetailRow(unit, catalogIndex);

    expect(row.right).toEqual([]);
    expect(row.more).toEqual([]);
  });
});
