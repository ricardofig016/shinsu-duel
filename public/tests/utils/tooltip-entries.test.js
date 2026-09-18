import {
  buildAttributeTooltipEntries,
  buildCatalogTooltipEntries,
  buildDeckTooltipEntries,
  buildEntryTitle,
  buildPositionTooltipEntries,
  buildRankTooltip,
  buildTypeLetterTooltip,
  buildUnitAbilityTooltipEntries,
  normalizeTooltipEntries,
} from "../../utils/tooltip-entries.js";

const glossary = {
  types: { skill: { name: "Skill", description: "Single-use." } },
  kinds: {
    standard: { name: "Unit", description: "The default kind." },
    shinheuh: { name: "Shinheuh", description: "Summoned by Animas." },
    landmark: { name: "Landmark", description: "Battlefield rules." },
  },
  ranks: {
    title: "Rank",
    concept: "Rank enforces a cost range.",
    list: [
      { code: "regular", name: "Regular", description: "a Regular", minCost: 0, maxCost: 5 },
      { code: "ranker", name: "Ranker", description: "a Ranker", minCost: 3, maxCost: 7 },
    ],
  },
  hud: {
    chosenSuffix: "(chosen)",
    deck: {
      name: "Deck",
      texts: [{ segments: [{ type: "value", ref: "count", text: "x" }, " cards remaining"] }],
    },
  },
  lines: { frontline: { label: "Frontline" } },
};

describe("normalizeTooltipEntries", () => {
  test("wraps a plain string into one unstyled entry", () => {
    expect(normalizeTooltipEntries("hello")).toEqual([{ text: "hello" }]);
  });

  test("accepts styled entries and drops unknown styles", () => {
    expect(normalizeTooltipEntries([{ text: "a", style: "italic" }, { text: "b", style: "blink" }])).toEqual([
      { text: "a", style: "italic" },
      { text: "b" },
    ]);
  });

  test("filters empty, whitespace-only, and invalid entries", () => {
    expect(normalizeTooltipEntries(["", "  ", null, 3, { text: "  " }, { text: "keep" }])).toEqual([
      { text: "keep" },
    ]);
  });

  test("returns an empty list for null or undefined payloads", () => {
    expect(normalizeTooltipEntries(null)).toEqual([]);
    expect(normalizeTooltipEntries(undefined)).toEqual([]);
  });

  test("passes segment entries through with their known style", () => {
    const segments = ["strike ", { type: "card", ref: "kranos", text: "Kranos" }];
    expect(normalizeTooltipEntries([
      { segments },
      { segments: [], style: "italic" },
      { segments, style: "italic" },
      { segments: "junk" },
    ])).toEqual([
      { segments },
      { segments, style: "italic" },
    ]);
  });

  test("passes pre-built node entries through", () => {
    const node = { className: "preview" };
    expect(normalizeTooltipEntries([{ node }])).toEqual([{ node }]);
  });

  test("carries a value map on a segment entry so its slots can fill", () => {
    const segments = ["I take -", { type: "value", ref: "trait", text: "x" }, " damage"];
    expect(normalizeTooltipEntries([{ segments, values: { trait: 3 }, style: "italic" }])).toEqual([
      { segments, style: "italic", values: { trait: 3 } },
    ]);
    expect(normalizeTooltipEntries([{ segments, values: "junk" }])).toEqual([{ segments }]);
  });
});

describe("buildEntryTitle", () => {
  test("states a numeric entry's value, and its placeholder when there is none", () => {
    expect(buildEntryTitle({ name: "Resilient", numeric: true }, 3)).toBe("Resilient 3");
    expect(buildEntryTitle({ name: "Resilient", numeric: true }, 0)).toBe("Resilient 0");
    // A static catalog link has no instance, so it titles the slot's absence.
    expect(buildEntryTitle({ name: "Resilient", numeric: true })).toBe("Resilient X");
  });

  test("keeps a non-numeric entry's plain name, and degrades without an entry", () => {
    expect(buildEntryTitle({ name: "Barrier", numeric: false })).toBe("Barrier");
    expect(buildEntryTitle({ name: "Barrier" })).toBe("Barrier");
    expect(buildEntryTitle(null)).toBe("");
  });
});

describe("buildPositionTooltipEntries", () => {
  const position = {
    line: "frontline",
    description: "Durable units that tank damage.",
    verboseDescription: "The long lore text.",
  };

  test("orders line label, description, then italic verbose description", () => {
    expect(buildPositionTooltipEntries(position, glossary)).toEqual([
      { text: "Frontline", style: "label" },
      { text: "Durable units that tank damage." },
      { text: "The long lore text.", style: "italic" },
    ]);
  });

  test("marks the chosen position's description with the server-owned suffix", () => {
    const entries = buildPositionTooltipEntries(position, glossary, { chosen: true });
    expect(entries[1]).toEqual({ text: "Durable units that tank damage. (chosen)" });
  });

  test("degrades to description and verbose text without a glossary", () => {
    expect(buildPositionTooltipEntries(position, null)).toEqual([
      { text: "Durable units that tank damage." },
      { text: "The long lore text.", style: "italic" },
    ]);
  });

  test("omits missing parts and returns empty for a missing position", () => {
    expect(buildPositionTooltipEntries({ description: "only" }, glossary)).toEqual([{ text: "only" }]);
    expect(buildPositionTooltipEntries(null, glossary)).toEqual([]);
  });

  test("keeps a compiled position description as segments, suffix and all", () => {
    const compiled = {
      line: "frontline",
      description: { segments: ["Durable units that tank ", { type: "trait", ref: "taunt", text: "Taunt" }] },
      verboseDescription: { segments: ["The long lore text."] },
    };

    expect(buildPositionTooltipEntries(compiled, glossary)).toEqual([
      { text: "Frontline", style: "label" },
      { segments: compiled.description.segments },
      { segments: compiled.verboseDescription.segments, style: "italic" },
    ]);

    // The chosen variant composes one plain line, so it projects the prose.
    expect(buildPositionTooltipEntries(compiled, glossary, { chosen: true })[1]).toEqual({
      text: "Durable units that tank Taunt (chosen)",
    });
  });
});

describe("buildAttributeTooltipEntries", () => {
  test("leads with the italic description, then the plain effect lines", () => {
    const attribute = {
      description: "Hwayeomsa are flame users.",
      effect: ["spend 1, Free: gain 1 Fire Charge", "Fire Core: Quick: spend Fire Charges"],
    };
    expect(buildAttributeTooltipEntries(attribute)).toEqual([
      { text: "Hwayeomsa are flame users.", style: "italic" },
      { text: "spend 1, Free: gain 1 Fire Charge" },
      { text: "Fire Core: Quick: spend Fire Charges" },
    ]);
  });

  test("survives a missing description or effect list", () => {
    expect(buildAttributeTooltipEntries({ effect: ["only effect"] })).toEqual([{ text: "only effect" }]);
    expect(buildAttributeTooltipEntries({ description: "only prose" })).toEqual([
      { text: "only prose", style: "italic" },
    ]);
    expect(buildAttributeTooltipEntries(null)).toEqual([]);
  });

  test("keeps compiled prose (and its links) as segment entries", () => {
    const segments = ["gain 1 ", { type: "rule", ref: "fire-charge", text: "Fire Charge" }];
    const attribute = {
      description: { segments: ["Hwayeomsa are flame users."] },
      effect: [{ segments }],
    };

    expect(buildAttributeTooltipEntries(attribute)).toEqual([
      { segments: ["Hwayeomsa are flame users."], style: "italic" },
      { segments },
    ]);
    expect(buildCatalogTooltipEntries(attribute)).toEqual(buildAttributeTooltipEntries(attribute));
  });
});

describe("buildCatalogTooltipEntries", () => {
  test("leads with the italic description and drops empty fields", () => {
    expect(buildCatalogTooltipEntries({ description: "I take x damage", effect: [] })).toEqual([
      { text: "I take x damage", style: "italic" },
    ]);
    expect(buildCatalogTooltipEntries({ effect: ["only effect"] })).toEqual([{ text: "only effect" }]);
    expect(buildCatalogTooltipEntries(null)).toEqual([]);
  });
});

describe("buildUnitAbilityTooltipEntries", () => {
  test("lists the unit's own abilities plainly, then granted abilities in italic", () => {
    const unit = {
      abilities: [{ code: "0", text: ["if i have 5+ equipments, give me ", { type: "trait", ref: "lethal", text: "Lethal" }] }],
      grantedAbilities: [
        { abilityCode: "granted:Card#16#117:grant_trait", sourceId: "Card#16#117", text: ["give me Pierce"] },
        { abilityCode: "granted:Card#17#105:deal_damage", sourceId: "Card#17#105", text: ["deal 5 to an enemy"] },
      ],
    };
    expect(buildUnitAbilityTooltipEntries(unit)).toEqual([
      { segments: ["if i have 5+ equipments, give me ", { type: "trait", ref: "lethal", text: "Lethal" }] },
      { segments: ["give me Pierce"], style: "italic" },
      { segments: ["deal 5 to an enemy"], style: "italic" },
    ]);
  });

  test("tolerates units without granted abilities and empty ability texts", () => {
    expect(buildUnitAbilityTooltipEntries({
      abilities: [{ code: "0", text: ["Peek at the opponent's hand."] }, { code: "1", text: [] }],
      grantedAbilities: [],
    })).toEqual([{ segments: ["Peek at the opponent's hand."] }]);
  });

  test("drops granted abilities without text and returns empty for missing lists", () => {
    expect(buildUnitAbilityTooltipEntries({
      abilities: [],
      grantedAbilities: [{ abilityCode: "granted:Card#1#2:deal_damage", text: [] }],
    })).toEqual([]);
    expect(buildUnitAbilityTooltipEntries({})).toEqual([]);
    expect(buildUnitAbilityTooltipEntries(null)).toEqual([]);
  });
});

describe("buildRankTooltip", () => {
  test("titles the tooltip, opens with the italic concept, and lists every rank", () => {
    const tooltip = buildRankTooltip("ranker", glossary.ranks);
    expect(tooltip.title).toBe("Rank");
    expect(tooltip.texts).toEqual([
      { text: "Rank enforces a cost range.", style: "italic" },
      { segments: ["Regular (cost 0-5): ", "a Regular"] },
      { segments: ["Ranker (cost 3-7): ", "a Ranker"], style: "strong" },
    ]);
  });

  test("returns null when the glossary carries no ranks", () => {
    expect(buildRankTooltip("ranker", null)).toBeNull();
    expect(buildRankTooltip("ranker", {})).toBeNull();
    expect(buildRankTooltip("ranker", { title: "Rank", list: [] })).toBeNull();
  });

  test("renders the served rank list, whose title and descriptions are compiled prose", () => {
    // Every prose field of the glossary compiles, the rank title included, so a
    // served title is `{ segments }` too. Reading either as a string printed
    // "[object Object]" in the tooltip.
    const ranks = {
      title: { segments: ["Rank"] },
      concept: { segments: ["How the person is ranked."] },
      list: [
        { code: "regular", name: "Regular", description: { segments: ["a Regular"] }, minCost: 0, maxCost: 5 },
        { code: "ranker", name: "Ranker", description: { segments: ["a Ranker"] }, minCost: 3, maxCost: 7 },
      ],
    };

    const tooltip = buildRankTooltip("ranker", ranks);
    expect(tooltip.title).toBe("Rank");
    expect(tooltip.texts).toEqual([
      { segments: ["How the person is ranked."], style: "italic" },
      { segments: ["Regular (cost 0-5): ", "a Regular"] },
      { segments: ["Ranker (cost 3-7): ", "a Ranker"], style: "strong" },
    ]);
  });

  test("keeps a compiled rank description's links after the cost label", () => {
    const ranks = {
      title: "Rank",
      concept: ["How the person is ranked."],
      list: [
        { code: "regular", name: "Regular", description: ["Someone chosen by ", { type: "rule", ref: "decks", text: "Headon" }], minCost: 0, maxCost: 5 },
      ],
    };

    expect(buildRankTooltip("regular", ranks).texts).toEqual([
      { segments: ["How the person is ranked."], style: "italic" },
      { segments: ["Regular (cost 0-5): ", "Someone chosen by ", { type: "rule", ref: "decks", text: "Headon" }], style: "strong" },
    ]);
  });
});

describe("buildTypeLetterTooltip", () => {
  test("units show their kind: standard as Unit, special kinds by kind name", () => {
    expect(buildTypeLetterTooltip({ type: "unit", kind: "standard" }, glossary)).toEqual({
      title: "Unit",
      texts: [{ text: "The default kind." }],
    });
    expect(buildTypeLetterTooltip({ type: "unit", kind: "shinheuh" }, glossary)).toEqual({
      title: "Shinheuh",
      texts: [{ text: "Summoned by Animas." }],
    });
    expect(buildTypeLetterTooltip({ type: "unit", kind: "landmark" }, glossary)).toEqual({
      title: "Landmark",
      texts: [{ text: "Battlefield rules." }],
    });
  });

  test("non-units show their type entry, and unknown kinds or types yield null", () => {
    expect(buildTypeLetterTooltip({ type: "skill" }, glossary)).toEqual({
      title: "Skill",
      texts: [{ text: "Single-use." }],
    });
    expect(buildTypeLetterTooltip({ type: "unit", kind: "no-such" }, glossary)).toBeNull();
    expect(buildTypeLetterTooltip({ type: "no-such" }, glossary)).toBeNull();
    expect(buildTypeLetterTooltip({ type: "skill" }, null)).toBeNull();
  });

  test("keeps a compiled kind description's links", () => {
    const linked = {
      kinds: {
        standard: {
          name: "Unit",
          description: { segments: ["Units occupy a ", { type: "rule", ref: "positions", text: "Position" }] },
        },
      },
    };

    expect(buildTypeLetterTooltip({ type: "unit", kind: "standard" }, linked)).toEqual({
      title: "Unit",
      texts: [{ segments: linked.kinds.standard.description.segments }],
    });
  });
});

describe("buildDeckTooltipEntries", () => {
  test("hands the compiled HUD copy over with the live count as a render value", () => {
    expect(buildDeckTooltipEntries(17, glossary.hud.deck)).toEqual([
      { segments: glossary.hud.deck.texts[0].segments, values: { count: 17 } },
    ]);
    expect(buildDeckTooltipEntries(17, null)).toEqual([]);
  });
});

/**
 * A payload is normally a list of entries, but catalog prose compiles to
 * segment objects, so a call site can hand a single field over by mistake. That
 * mistake threw `raw is not iterable` inside a card's tooltip, which rejected
 * the card's render, which rejected the grid mount, which left the cards page
 * with no facet options and no sorting, because the page's setup never finished.
 */
describe("normalizeTooltipEntries payload shapes", () => {
  test("takes a lone segment field as one entry instead of throwing", () => {
    const field = { segments: ["Spend 1, ", { type: "keyword", ref: "free", text: "Free" }] };
    expect(normalizeTooltipEntries(field)).toEqual([{ segments: field.segments }]);
  });

  test("takes a lone text entry, a lone string, and a missing payload", () => {
    expect(normalizeTooltipEntries({ text: "Durable units.", style: "italic" })).toEqual([
      { text: "Durable units.", style: "italic" },
    ]);
    expect(normalizeTooltipEntries("Durable units.")).toEqual([{ text: "Durable units." }]);
    expect(normalizeTooltipEntries(null)).toEqual([]);
    expect(normalizeTooltipEntries(undefined)).toEqual([]);
  });
});
