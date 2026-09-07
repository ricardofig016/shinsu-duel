import {
  buildAttributeTooltipEntries,
  buildDeckTooltipText,
  buildPositionTooltipEntries,
  buildRankTooltip,
  buildTypeLetterTooltip,
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
    deck: { name: "Deck", textTemplate: "{count} cards remaining" },
  },
  lines: { frontline: { label: "Frontline" } },
};

describe("normalizeTooltipEntries", () => {
  test("wraps a plain string into one unstyled entry", () => {
    expect(normalizeTooltipEntries("hello")).toEqual([{ text: "hello", style: null }]);
  });

  test("accepts styled entries and drops unknown styles", () => {
    expect(normalizeTooltipEntries([{ text: "a", style: "italic" }, { text: "b", style: "blink" }])).toEqual([
      { text: "a", style: "italic" },
      { text: "b", style: null },
    ]);
  });

  test("filters empty, whitespace-only, and invalid entries", () => {
    expect(normalizeTooltipEntries(["", "  ", null, 3, { text: "  " }, { text: "keep" }])).toEqual([
      { text: "keep", style: null },
    ]);
  });

  test("returns an empty list for null or undefined payloads", () => {
    expect(normalizeTooltipEntries(null)).toEqual([]);
    expect(normalizeTooltipEntries(undefined)).toEqual([]);
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
});

describe("buildRankTooltip", () => {
  test("titles the tooltip, opens with the italic concept, and lists every rank", () => {
    const tooltip = buildRankTooltip("ranker", glossary.ranks);
    expect(tooltip.title).toBe("Rank");
    expect(tooltip.texts).toEqual([
      { text: "Rank enforces a cost range.", style: "italic" },
      { text: "Regular (cost 0-5): a Regular" },
      { text: "Ranker (cost 3-7): a Ranker", style: "strong" },
    ]);
  });

  test("returns null when the glossary carries no ranks", () => {
    expect(buildRankTooltip("ranker", null)).toBeNull();
    expect(buildRankTooltip("ranker", {})).toBeNull();
    expect(buildRankTooltip("ranker", { title: "Rank", list: [] })).toBeNull();
  });
});

describe("buildTypeLetterTooltip", () => {
  test("units show their kind: standard as Unit, special kinds by kind name", () => {
    expect(buildTypeLetterTooltip({ type: "unit", kind: "standard" }, glossary)).toEqual({
      title: "Unit",
      texts: ["The default kind."],
    });
    expect(buildTypeLetterTooltip({ type: "unit", kind: "shinheuh" }, glossary)).toEqual({
      title: "Shinheuh",
      texts: ["Summoned by Animas."],
    });
    expect(buildTypeLetterTooltip({ type: "unit", kind: "landmark" }, glossary)).toEqual({
      title: "Landmark",
      texts: ["Battlefield rules."],
    });
  });

  test("non-units show their type entry, and unknown kinds or types yield null", () => {
    expect(buildTypeLetterTooltip({ type: "skill" }, glossary)).toEqual({
      title: "Skill",
      texts: ["Single-use."],
    });
    expect(buildTypeLetterTooltip({ type: "unit", kind: "no-such" }, glossary)).toBeNull();
    expect(buildTypeLetterTooltip({ type: "no-such" }, glossary)).toBeNull();
    expect(buildTypeLetterTooltip({ type: "skill" }, null)).toBeNull();
  });
});

describe("buildDeckTooltipText", () => {
  test("fills the server-owned template with the live count", () => {
    expect(buildDeckTooltipText(17, glossary.hud.deck)).toBe("17 cards remaining");
    expect(buildDeckTooltipText(17, null)).toBeNull();
  });
});
