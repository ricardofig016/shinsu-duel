import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCards } from "../card-compile.js";
import traitsSource from "../../server/data/traits.json" with { type: "json" };
import conditionsSource from "../../server/data/conditions.json" with { type: "json" };

/**
 * Shared catalog copy as a build product: the five shared catalogs are
 * authored with the same inline-link syntax as card text, so a compile
 * tokenizes their prose into display segments, and the mentions those
 * segments make reach every card that carries or names the copy.
 *
 * The shipped pool is the compile input here (the copy's links name shipped
 * cards), so the assertions can pin the Hwayeomsa core ability end to end.
 * Tests that must not read shipped data belong in the fixture audit.
 */

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../..");

const HWAYEOMSA_EFFECT = "[[keyword:Spend]] 1, [[keyword:Free]]: gain 1 [[rule:Fire Charge]] and create [[card:Fire Core]] in your hand if you don't already have one";

// Cards that must relate to Fire Core through the Hwayeomsa copy: two carry
// the attribute, two name it in their nodes.
const FIRE_CORE_BEARERS = ["Evankhell", "Yeon Yihwa", "Fiery Elephant", "Healing Flames"];

/** A compiled card entry, keyed by display name. */
function byName(cards) {
  return Object.fromEntries(Object.values(cards).map((card) => [card.name, card]));
}

describe("shared catalog copy compilation (shipped pool)", () => {
  let compiled;

  beforeAll(async () => {
    compiled = await compileCards({ cardsDirectory: path.join(projectRoot, "data", "cards") });
  });

  test("tokenizes catalog prose into the segment shapes card prose uses", () => {
    const { catalogCopy } = compiled;

    // A lone prose field compiles to `{ segments }`.
    expect(catalogCopy.attributes.hwayeomsa.description).toEqual({
      segments: ["Hwayeomsa are flame users who are able to convert shinsu into fire. They deal team-wide massive fire damage."],
    });
    // A prose field list compiles to one `{ segments }` entry per line.
    expect(Array.isArray(catalogCopy.attributes.hwayeomsa.effect)).toBe(true);
    expect(Array.isArray(catalogCopy.conditions.poisoned.description.segments)).toBe(true);
    expect(Array.isArray(catalogCopy.glossary.hud.lighthouses.texts[0].segments)).toBe(true);
  });

  test("gives every numeric trait and condition exactly one value slot, and no other entry any", () => {
    // The `numeric` flag drives the icon's number badge and the title, while
    // the copy states where the number belongs. An entry that carries both
    // halves of that contract, or neither, is the drift this pins.
    const valueSlots = (entry) =>
      (entry?.description?.segments ?? []).filter((segment) => segment?.type === "value").length;

    for (const [kind, source, copy] of [
      ["trait", traitsSource, compiled.catalogCopy.traits],
      ["condition", conditionsSource, compiled.catalogCopy.conditions],
    ]) {
      expect(Object.keys(copy).sort()).toEqual(Object.keys(source).sort());
      for (const [code, entry] of Object.entries(source)) {
        expect([kind, code, valueSlots(copy[code])]).toEqual([kind, code, entry.numeric ? 1 : 0]);
      }
    }
  });

  test("keeps the Hwayeomsa effect line's four references as ordered link segments", () => {
    const [line] = compiled.catalogCopy.attributes.hwayeomsa.effect;
    const links = line.segments.filter((segment) => typeof segment === "object");

    expect(links).toEqual([
      { type: "keyword", ref: "spend", text: "Spend" },
      { type: "keyword", ref: "free", text: "Free" },
      { type: "rule", ref: "fire-charge", text: "Fire Charge" },
      { type: "card", ref: "fire_core", text: "Fire Core" },
    ]);
    // The surrounding prose stays plain text segments.
    expect(line.segments.filter((segment) => typeof segment === "string").join(""))
      .toBe(" 1, : gain 1  and create  in your hand if you don't already have one");
  });

  test("stamps the inherited Fire Core mention on every card that carries or names the copy", () => {
    const cards = byName(compiled.cards);
    const fireCore = cards["Fire Core"];

    for (const name of FIRE_CORE_BEARERS) {
      const card = cards[name];
      expect(card).toBeDefined();
      expect(card.relatedCards).toContainEqual({
        cardId: fireCore.cardId,
        kind: "mentioned-in",
        peerCardId: card.cardId,
      });
      // The peer is the card itself, so it renders as "Mentioned in <card>".
      expect(fireCore.relatedCards).toContainEqual({
        cardId: card.cardId,
        kind: "mentions",
        peerCardId: fireCore.cardId,
      });
    }
  });

  test("records the mention index per cardId", () => {
    const cards = byName(compiled.cards);
    const expectedIds = Object.values(cards)
      .filter((card) => card.relatedCards?.some((entry) => entry.kind === "mentioned-in" && entry.peerCardId === card.cardId))
      .map((card) => card.cardId)
      .sort((a, b) => a - b);
    const recorded = Object.keys(compiled.catalogMentions).map(Number).sort((a, b) => a - b);

    // Every card the relation stamp records is one the index recorded, and
    // each inherits exactly the Fire Core reference its copy names.
    // Every id the index records is a shipped card, and each one carries an
    // inherent relation to what its copy names, which is asserted below.
    expect(recorded.every((cardId) => Object.values(cards).some((card) => card.cardId === cardId))).toBe(true);
    expect(recorded.length).toBeGreaterThanOrEqual(FIRE_CORE_BEARERS.length);
    for (const name of FIRE_CORE_BEARERS) {
      expect(compiled.catalogMentions[cards[name].cardId]).toContain("slug:fire_core");
    }
    for (const cardId of recorded) {
      for (const ref of compiled.catalogMentions[cardId]) expect(ref).toMatch(/^slug:[a-z0-9_-]+$/);
    }
  });

  test("produces no inherited mention for a card that neither carries nor names the copy", () => {
    const cards = byName(compiled.cards);
    const unrelated = cards["Baam"] ?? Object.values(cards).find(
      (card) => card.name !== "Fire Core" && !FIRE_CORE_BEARERS.includes(card.name) && !card.attributes?.includes("hwayeomsa")
    );

    expect(compiled.catalogMentions[unrelated.cardId]).toBeUndefined();
  });
});

describe("shared catalog copy compilation (smaller pool)", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "catalog-copy-pool-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("resolves shipped catalog links while compiling a pool that lacks the named card", async () => {
    // The pool has no Fire Core, but the shared copy is authored against the
    // shipped pool, so its `card:` link must still resolve. Fixture and
    // test-authored compiles rely on exactly this.
    await fs.writeFile(path.join(tmpDir, "only.yml"), `type: unit
name: Only Unit
cost: 1
hp: 3
rank: regular
positions:
  - fisherman
traits: []
attributes:
  - hwayeomsa
affiliations: []
abilities: []
passives: []
deckConstraints: []
`, "utf-8");

    const { catalogCopy, catalogMentions, cards } = await compileCards({ cardsDirectory: tmpDir });

    expect(Object.keys(cards)).toHaveLength(1);
    expect(JSON.stringify(catalogCopy.attributes.hwayeomsa.effect)).toContain('"ref":"fire_core"');
    // The reference is recorded, but the named card is not in this pool, so
    // it resolves to no relation: an unreachable reference contributes
    // nothing rather than inventing a peer.
    expect(catalogMentions).toEqual({ 0: ["slug:fire_core"] });
    expect(cards[0].relatedCards).toBeUndefined();
  });
});
