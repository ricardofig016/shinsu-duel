import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import attributes from "../../../data/attributes.json" with { type: "json" };
import conditions from "../../../data/conditions.json" with { type: "json" };
import glossary from "../../../data/glossary.json" with { type: "json" };
import positions from "../../../data/positions.json" with { type: "json" };
import traits from "../../../data/traits.json" with { type: "json" };

/**
 * RULES.md is the source of truth for player-facing descriptions. This audit
 * keeps the shipped display copy (conditions, traits, positions, attributes,
 * and the glossary's rank descriptions) verbatim-aligned with it: every
 * description must appear in RULES.md once markdown syntax is stripped.
 * Descriptions are compared sentence by sentence so composed descriptions
 * (e.g. the guide umbrella line plus the specific prose) still verify.
 * Legitimate rule changes therefore require updating the data in the same
 * change as RULES.md, and the audit fails while the two drift apart.
 */

const rulesPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "RULES.md"
);
const rules = fs.readFileSync(rulesPath, "utf-8");

/** Strip links, emphasis, and code spans; lowercase; squash whitespace. */
const normalize = (text) =>
  text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

const normalizedRules = normalize(rules);

const sentencesOf = (text) =>
  normalize(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.replace(/[.!?]$/, ""));

const expectEverySentenceInRules = (text) => {
  const sentences = sentencesOf(text);
  expect(sentences.length).toBeGreaterThan(0);
  for (const sentence of sentences) {
    expect(normalizedRules).toContain(sentence);
  }
};

describe("shipped description data matches RULES.md", () => {
  describe("conditions", () => {
    for (const [code, condition] of Object.entries(conditions)) {
      test(`${condition.name} description`, () => {
        expectEverySentenceInRules(condition.description);
      });
    }
  });

  describe("traits", () => {
    for (const [code, trait] of Object.entries(traits)) {
      test(`${trait.name} description`, () => {
        expectEverySentenceInRules(trait.description);
      });
    }
  });

  describe("positions", () => {
    for (const [code, position] of Object.entries(positions)) {
      test(`${position.name} description`, () => {
        expectEverySentenceInRules(position.description);
      });
    }
  });

  describe("glossary rank descriptions", () => {
    for (const [code, rank] of Object.entries(glossary.ranks)) {
      if (code === "title" || code === "concept") continue;
      test(`${rank.name} description`, () => {
        expectEverySentenceInRules(rank.description);
      });
    }
  });
});
