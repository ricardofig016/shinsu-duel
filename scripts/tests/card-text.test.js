import { createLinkRegistry } from "../lib/card-link-registry.js";
import { LINK_TYPES, segmentsToPlainText, tokenizeSegments } from "../../public/utils/card-text.js";

// The link-target registry maps link types onto the shared data catalogs
// (conditions, traits, attributes, positions, affiliations, glossary), so the
// vocabulary in these tests is the shipped one: "burned" is the condition
// code, "Strong" the trait display name, and glossary terms/keywords hold the
// rule-term and keyword copy.

const registry = createLinkRegistry({
  names: ["Yuga", "Bull", "Kranos", "Kranos - Ignited"],
  series: ["Incinerate", "Thorn Fragment"],
});

describe("tokenizeSegments", () => {
  test("plain text becomes a single string segment", () => {
    expect(tokenizeSegments("deal 7 to an enemy", "card.raw", registry)).toEqual(["deal 7 to an enemy"]);
  });

  test("tokenizes a card link with the card's canonical name and slug", () => {
    const segments = tokenizeSegments("when I am deployed, summon [[card:Bull]]", "card.raw", registry);
    expect(segments).toEqual([
      "when I am deployed, summon ",
      { type: "card", ref: "bull", text: "Bull" },
    ]);
  });

  test("matches card names case-insensitively and stamps slugs", () => {
    const segments = tokenizeSegments("[[card:KRANOS - IGNITED]]", "c.raw", registry);
    expect(segments).toEqual([{ type: "card", ref: "kranos_ignited", text: "Kranos - Ignited" }]);
  });

  test("resolves catalog types by code or display name", () => {
    expect(tokenizeSegments("give [[condition:Burned]] 1", "c.raw", registry))
      .toEqual(["give ", { type: "condition", ref: "burned", text: "Burned" }, " 1"]);
    expect(tokenizeSegments("[[trait:Strong]]", "c.raw", registry))
      .toEqual([{ type: "trait", ref: "strong", text: "Strong" }]);
    expect(tokenizeSegments("[[attribute:Anima]]", "c.raw", registry))
      .toEqual([{ type: "attribute", ref: "anima", text: "Anima" }]);
    expect(tokenizeSegments("[[position:Wave Controller]]", "c.raw", registry))
      .toEqual([{ type: "position", ref: "wave-controller", text: "Wave Controller" }]);
    expect(tokenizeSegments("[[affiliation:Team Baam]]", "c.raw", registry))
      .toEqual([{ type: "affiliation", ref: "team-baam", text: "Team Baam" }]);
  });

  test("resolves series links and preserves the authored series casing", () => {
    expect(tokenizeSegments("[[series:Incinerate]]", "c.raw", registry))
      .toEqual([{ type: "series", ref: "incinerate", text: "Incinerate" }]);
  });

  test("resolves glossary links through their sections", () => {
    expect(tokenizeSegments("i am [[keyword:Quick]]", "c.raw", registry))
      .toEqual(["i am ", { type: "keyword", ref: "quick", text: "Quick" }]);
    expect(tokenizeSegments("costs [[rule:shinsu]]", "c.raw", registry))
      .toEqual(["costs ", { type: "rule", ref: "shinsu", text: "Shinsu" }]);
    expect(tokenizeSegments("[[trigger:Round Start]]", "c.raw", registry))
      .toEqual([{ type: "trigger", ref: "round-start", text: "Round Start" }]);
    expect(tokenizeSegments("[[rank:Regular]]", "c.raw", registry))
      .toEqual([{ type: "rank", ref: "regular", text: "Regular" }]);
  });

  test("a display alias overrides the canonical text", () => {
    expect(tokenizeSegments("give [[card:Kranos|Kranos' blade]]", "c.raw", registry))
      .toEqual(["give ", { type: "card", ref: "kranos", text: "Kranos' blade" }]);
  });

  test("text around links is preserved verbatim", () => {
    expect(tokenizeSegments("[[card:Bull]]", "c.raw", registry))
      .toEqual([{ type: "card", ref: "bull", text: "Bull" }]);
    expect(tokenizeSegments("a [[condition:Burned]] b", "c.raw", registry))
      .toEqual(["a ", { type: "condition", ref: "burned", text: "Burned" }, " b"]);
  });

  test("rejects an unknown link target with the source path", () => {
    expect(() => tokenizeSegments("summon [[card:Ghost]]", "cards/unit.yml:abilities[0].raw", registry))
      .toThrow('cards/unit.yml:abilities[0].raw: unknown card link target "Ghost"');
    expect(() => tokenizeSegments("[[condition:Shattered]]", "c.raw", registry))
      .toThrow('unknown condition link target "Shattered"');
    expect(() => tokenizeSegments("[[series:Unknown Series]]", "c.raw", registry))
      .toThrow('unknown series link target "Unknown Series"');
  });

  test("rejects unknown link types and malformed links", () => {
    expect(() => tokenizeSegments("[[banana:Bull]]", "c.raw", registry))
      .toThrow('unknown link type "banana"');
    expect(() => tokenizeSegments("[[Bull]]", "c.raw", registry))
      .toThrow('must be shaped [[type:ref]]');
    expect(() => tokenizeSegments("[[card: ]]", "c.raw", registry))
      .toThrow('has an empty reference');
    expect(() => tokenizeSegments("[[card:Bull|]]", "c.raw", registry))
      .toThrow('has an empty alias');
  });

  test("rejects parameters until parameter keys are defined", () => {
    expect(() => tokenizeSegments("[[card:Bull|Bull|hover=big]]", "c.raw", registry))
      .toThrow("declares unknown parameters");
  });

  test("fails loudly on an unclosed link marker", () => {
    expect(() => tokenizeSegments("summon [[card:Bull from your deck", "c.raw", registry))
      .toThrow('unclosed link marker "[["');
  });

  test("fails loudly on a stray marker even when a valid link follows", () => {
    expect(() => tokenizeSegments("a [[ b and [[card:Bull]]", "c.raw", registry))
      .toThrow('unclosed link marker "[["');
  });

  test("requires a registry when the text carries links", () => {
    expect(() => tokenizeSegments("[[card:Bull]]", "c.raw", null))
      .toThrow("no link registry is available");
    expect(tokenizeSegments("no links here", "c.raw", null)).toEqual(["no links here"]);
  });

  test("rejects empty authored text", () => {
    expect(() => tokenizeSegments("   ", "c.raw", registry)).toThrow("must be a non-empty string");
  });

  test("exposes the full launch vocabulary of link types", () => {
    expect(LINK_TYPES).toEqual([
      "card", "condition", "trait", "attribute", "position",
      "affiliation", "series", "keyword", "rule", "trigger", "rank",
    ]);
  });
});

describe("segmentsToPlainText", () => {
  test("joins segments into exactly the text a player reads", () => {
    const segments = tokenizeSegments("when I am deployed, summon [[card:Bull]] from your deck or hand", "c.raw", registry);
    expect(segmentsToPlainText(segments)).toBe("when I am deployed, summon Bull from your deck or hand");
  });

  test("aliases replace the canonical text in the plain projection", () => {
    const segments = tokenizeSegments("give [[card:Kranos|Kranos' blade]] to me", "c.raw", registry);
    expect(segmentsToPlainText(segments)).toBe("give Kranos' blade to me");
  });

  test("returns an empty string for absent segments", () => {
    expect(segmentsToPlainText(undefined)).toBe("");
    expect(segmentsToPlainText(null)).toBe("");
    expect(segmentsToPlainText([])).toBe("");
  });
});
