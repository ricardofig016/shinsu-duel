import { toCode } from "./code.js";
import { normalizeAttribute } from "./attribute-code.js";
import { normalizePosition } from "./position-code.js";

/**
 * Shared catalog copy as a relation source.
 *
 * A card inherits the mentions of every piece of shared copy it **carries or
 * names**:
 *
 * - carries: the attributes, printed traits, and positions it holds;
 * - names: a shared reference anywhere in its nodes, machine-readable
 *   (`card: { attribute: hwayeomsa }`) or as a link segment
 *   (`[[attribute:Hwayeomsa]]`), a condition it applies, or a glossary entry
 *   it links.
 *
 * Each inherited mention is recorded as if the copy were the card's own copy,
 * so a peer reached this way tags the card itself (`Mentioned in <this card>`
 * / `Mentions <this card>`). The traversal contract belongs to
 * `scripts/lib/card-relations.js`; this module only resolves which pool cards
 * one card's shared copy names.
 */

/** Catalog link type → authoring catalog file. */
const CATALOGS = Object.freeze({
  attribute: "attributes",
  trait: "traits",
  position: "positions",
  condition: "conditions",
});

/** Node fields naming shared catalog vocabulary, and the catalog each names. */
const NAMED_ENTITY_KEYS = Object.freeze({
  condition: "condition",
  trait: "trait",
  traitNot: "trait",
  attribute: "attribute",
  position: "position",
});

const EXCLUDED_KEYS = new Set(["_evolveRaw", "_ignitionRaw"]);
const isReferenceValue = (value) => typeof value === "string" || Array.isArray(value);

function normalizedReferences(value, catalogType) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => normalizedReferences(item, catalogType));
  }
  if (typeof value !== "string" || value.trim() === "") return [];
  // Attributes resolve through the compiler's own display-name map; every
  // other catalog normalizes a display name or code with the shared code rule.
  if (catalogType === "attribute") return [normalizeAttribute(value)];
  return [toCode(value)];
}

/**
 * Index a compiled catalog copy artifact: catalog type → entry code → the
 * `card` and `series` references that entry's copy makes, deduplicated and in
 * the order the copy names them.
 *
 * @param {object} catalogCopy compiled catalog copy artifact
 * @returns {Map<string, Map<string, string[]>>}
 */
export function buildCatalogMentions(catalogCopy) {
  const mentions = new Map();

  const record = (kind, code, ref) => {
    if (!mentions.has(kind)) mentions.set(kind, new Map());
    const byCode = mentions.get(kind);
    if (!byCode.has(code)) byCode.set(code, []);
    const refs = byCode.get(code);
    if (!refs.includes(ref)) refs.push(ref);
  };

  const recordSegments = (kind, code, segments) => {
    if (!Array.isArray(segments)) return;
    for (const segment of segments) {
      if (!segment || typeof segment !== "object") continue;
      if (segment.type === "card") record("card", code, segment.ref);
      else if (segment.type === "series") record("series", code, segment.ref);
      // Every other link type points at vocabulary, not at a card.
    }
  };

  const recordFields = (kind, code, fields) => {
    if (Array.isArray(fields)) {
      // A field list (attribute effect lines, glossary HUD texts) holds one
      // compiled entry per line.
      for (const item of fields) recordFields(kind, code, item);
      return;
    }
    if (!fields || typeof fields !== "object") return;
    if (Array.isArray(fields.segments)) recordSegments(kind, code, fields.segments);
    for (const value of Object.values(fields)) {
      if (value && typeof value === "object") recordFields(kind, code, value);
    }
  };

  const recordSection = (kind, section) => {
    for (const [code, fields] of Object.entries(section ?? {})) recordFields(kind, code, fields);
  };

  for (const catalogName of Object.values(CATALOGS)) {
    recordSection(catalogName, catalogCopy?.[catalogName]);
  }

  const glossary = catalogCopy?.glossary ?? {};
  for (const section of [
    glossary.types,
    glossary.kinds,
    glossary.concepts,
    glossary.terms,
    glossary.triggers,
    glossary.keywords,
    glossary.ranks,
  ]) {
    recordSection("glossary", section);
  }

  return mentions;
}

/**
 * The `card` and series references one card's shared copy contributes,
 * keyed for the relation traversal (`slug:<slug>` and `series:<code>`).
 *
 * @param {object} rawCard authored card
 * @param {{ mentions: Map<string, Map<string, string[]>> }} source
 * @returns {string[]} sorted reference keys
 */
export function catalogReferencesForCard(rawCard, { mentions }) {
  const references = new Set();

  const addCopyMentions = (catalogType, code) => {
    if (!code) return;
    for (const ref of mentions.get("card")?.get(code) ?? []) references.add(`slug:${ref}`);
    for (const ref of mentions.get("series")?.get(code) ?? []) references.add(`series:${ref}`);
  };

  const addSegments = (segments) => {
    if (!Array.isArray(segments)) return;
    for (const segment of segments) {
      if (!segment || typeof segment !== "object") continue;
      if (segment.type === "card") references.add(`slug:${segment.ref}`);
      else if (segment.type === "series") references.add(`series:${segment.ref}`);
    }
  };

  const walk = (value) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (EXCLUDED_KEYS.has(key)) continue;
      if (key === "text" || key === "texts") addSegments(child);
      if (NAMED_ENTITY_KEYS[key] && isReferenceValue(child)) {
        for (const code of normalizedReferences(child, NAMED_ENTITY_KEYS[key])) {
          addCopyMentions(NAMED_ENTITY_KEYS[key], code);
        }
      }
      walk(child);
    }
  };

  // Carried copy: the attributes, printed traits, and positions the card holds.
  for (const value of rawCard.attributes ?? []) addCopyMentions("attribute", normalizeAttribute(value));
  for (const trait of rawCard.traits ?? []) addCopyMentions("trait", toCode(trait));
  for (const position of rawCard.positions ?? []) addCopyMentions("position", normalizePosition(position));

  walk(rawCard);

  return [...references].sort();
}

/**
 * Resolve every card's inherited mentions into its extra forward references.
 * One entry per cardId, ordered by cardId; a card that inherits nothing is
 * absent.
 *
 * @param {object[]} cards compiled cards carrying final `cardId`
 * @param {object[]} rawCards authored cards, matched to `cards` by name
 * @param {{ mentions: Map<string, Map<string, string[]>> }} source
 * @returns {Record<number, string[]>}
 */
export function packageCatalogMentions(cards, rawCards, source) {
  const rawByName = new Map(rawCards.map((card) => [card.name, card]));
  const packaged = {};
  for (const card of cards) {
    const raw = rawByName.get(card.name);
    if (!raw) continue;
    const references = catalogReferencesForCard(raw, source);
    if (references.length > 0) packaged[card.cardId] = references;
  }
  return Object.fromEntries(Object.entries(packaged).sort((a, b) => Number(a[0]) - Number(b[0])));
}
