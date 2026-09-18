import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

import { collectCardFiles } from "./lib/collect-card-files.js";
import { normalizeName } from "./lib/normalize-name.js";
import { toCode } from "./lib/code.js";
import { ATTRIBUTE_CODES, normalizeAttribute as normalizeAttributeCode } from "./lib/attribute-code.js";
import { POSITION_CODES, normalizePosition as normalizePositionCode } from "./lib/position-code.js";
import { MAX_STAGE, MIN_STAGE, parseStage, stageName } from "./lib/stage-name.js";
import { tokenizeSegments } from "../public/utils/card-text.js";
import { createPoolLinkRegistry } from "./lib/card-link-registry.js";
import { stampRelatedCards } from "./lib/card-relations.js";
import { compileCatalogCopy, serializeArtifact } from "./lib/compiled-catalog.js";
import { buildCatalogMentions, packageCatalogMentions } from "./lib/catalog-mentions.js";
import dslCatalog from "../schemas/dsl-catalog.json" with { type: "json" };
import attributesCatalog from "../server/data/attributes.json" with { type: "json" };
import traitsCatalog from "../server/data/traits.json" with { type: "json" };
import positionsCatalog from "../server/data/positions.json" with { type: "json" };
import conditionsCatalog from "../server/data/conditions.json" with { type: "json" };
import glossaryCatalog from "../server/data/glossary.json" with { type: "json" };

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const cardsDirectory = path.join(projectRoot, "data", "cards");
const outputPath = path.join(projectRoot, "server", "data", "cards.json");
const catalogCopyPath = path.join(projectRoot, "server", "data", "compiled", "catalog-copy.json");
const catalogMentionsPath = path.join(projectRoot, "server", "data", "compiled", "catalog-mentions.json");
const iconsDir = path.join(projectRoot, "public", "assets", "icons");
const artworksDir = path.join(projectRoot, "public", "assets", "images", "artworks");
const validatorPath = path.join(projectRoot, "scripts", "card-validate.js");
const compiledSchemaPath = path.join(projectRoot, "schemas", "compiled-cards.schema.json");

// ── Code mapping helpers ────────────────────────────────────────────────────
// Position and attribute display names normalize to their catalog codes
// through the shared maps in ./lib, which the relation resolver uses too.

// ── Trait parsing ───────────────────────────────────────────────────────────

function parseTrait(raw) {
  const str = String(raw).trim();
  const match = /^(.+?)(?:\s+(\d+))?$/i.exec(str);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const value = match[2] ? parseInt(match[2], 10) : null;
  return {
    code: name.replace(/\s+/g, "-"), // matches traits.json keys (e.g. "last-one-standing")
    value: value,
  };
}

// ── Structured DSL node compilation ─────────────────────────────────────────
// Effects, abilities, and passives are authored as structured DSL nodes in
// YAML (see docs/COMPILED_CARD_DSL.md). The compiler validates and normalizes
// them — it never guesses meaning from prose. `raw` is display-only text and
// is preserved verbatim. Human-readable vocab in code-bearing fields is
// normalized to internal codes before the compiled-schema check.

const NESTED_NODE_KEYS = ["effect", "ability", "then", "otherwise"];
const NESTED_DESCRIPTOR_KEYS = ["target", "targets", "card", "source", "if", "trigger", "when"];

// Node ownership — `schemas/dsl-catalog.json` is the canonical inventory of
// DSL discriminators. The compiler refuses any node, trigger, or predicate
// type outside it, so unknown vocabulary fails at the source path that
// introduced it instead of as a late schema error. Nested nodes are checked
// too: `normalizeEffectObject` routes every nested node through `compileNode`.
const CATALOG_NODE_TYPES = new Set([
  ...dslCatalog.structural,
  ...dslCatalog.markers,
  ...dslCatalog.effects,
  ...dslCatalog.modifiers,
  ...dslCatalog.rules,
]);
const CATALOG_TRIGGER_TYPES = new Set(dslCatalog.triggers);
const CATALOG_PREDICATE_TYPES = new Set(dslCatalog.predicates);
const CATALOG_REQUIREMENT_TYPES = new Set(dslCatalog.requirements);

function normalizeCondition(value) {
  return String(value).trim().toLowerCase();
}

function normalizeTrait(value) {
  return toCode(value);
}

// Keywords compile to uniform objects: a bare string becomes { code }, and an
// authored { code, raw } object carries its display text. The compiled shape
// mirrors compiled traits ({ code, value? }) — one representation per keyword.
export function normalizeKeyword(value) {
  if (typeof value === "string") {
    if (value.trim() === "") throw new Error(`keywords: empty keyword`);
    return { code: toCode(value) };
  }
  if (value && typeof value === "object" && typeof value.code === "string" && value.code.trim() !== "") {
    const keyword = { code: toCode(value.code) };
    if (typeof value.raw === "string" && value.raw.trim() !== "") {
      keyword.raw = value.raw;
    }
    return keyword;
  }
  throw new Error(`keywords: expected a string or { code, raw } object, got ${JSON.stringify(value)}`);
}

// Position filters in target/predicate descriptors map display names to codes.
// The special kinds (shinheuh/landmark/conduit) are filtered via `kind`/`line`,
// not `position`, so position filters only ever reference the five main positions.
function normalizePositionFilter(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => normalizePosition(item));
  return normalizePosition(value);
}

function normalizeAffiliation(value) {
  return toCode(value);
}

// Position and attribute display names normalize through the shared maps in
// ./lib, which the relation resolver uses too.
const normalizePosition = (value) => normalizePositionCode(value);
const normalizeAttribute = (value) => normalizeAttributeCode(value);

function normalizeRank(value) {
  // Ranks keep their space ("high ranker"), unlike dashed codes.
  return String(value).trim().toLowerCase();
}

function normalizeKind(value) {
  return toCode(value);
}

function normalizeLine(value) {
  return String(value).trim().toLowerCase();
}

// Filter fields (affiliation/attribute/rank/position) may be a single value or
// an array expressing OR-matching. Normalize each element the same way.
export function normalizeList(value, fn) {
  if (Array.isArray(value)) return value.map((item) => fn(item));
  return fn(value);
}

// ── Link registry ───────────────────────────────────────────────────────────
// One registry per compilation pool, built from the pool's names and series,
// backs every text-link tokenization below.

function linkRegistryFor(cards, fallback = null) {
  return createPoolLinkRegistry(cards, fallback);
}

let shippedRegistry = null;

/**
 * Link registry for the shipped card pool. Shared catalog copy is authored
 * against that pool, so its `card:` links resolve here even when the cards
 * being compiled belong to a different pool.
 */
export function shippedLinkRegistry() {
  if (!shippedRegistry) {
    const shipped = JSON.parse(fsSync.readFileSync(outputPath, "utf-8"));
    shippedRegistry = createPoolLinkRegistry(Object.values(shipped));
  }
  return shippedRegistry;
}

/**
 * Compile the shared catalog copy that card prose and tooltips display.
 *
 * The catalogs are the authoring source; the compiled artifact is a build
 * product that is never read back into a source file. Their `card:` links
 * name cards from the **shipped pool**, which is where the copy is authored,
 * so the registry carries the shipped pool's names and series and a caller
 * that compiles a different pool (fixtures) merges that pool in. Compiling
 * them against a fixture-only pool would fail on every shipped reference.
 *
 * @param {{ resolve: (type: string, ref: string) => object | null }} [registry]
 *   pool link registry; defaults to the shipped pool
 * @returns {object} compiled catalog copy artifact
 */
export function compileSharedCatalogCopy(registry = shippedLinkRegistry()) {
  return compileCatalogCopy(
    {
      attributes: attributesCatalog,
      traits: traitsCatalog,
      positions: positionsCatalog,
      conditions: conditionsCatalog,
      glossary: glossaryCatalog,
    },
    registry
  );
}

export function normalizeEffectObject(obj, context, linkRegistry = null) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(`${context}: expected an object`);
  }

  const normalized = { ...obj };

  // Authored display text compiles into display segments at the node's own
  // source path, replacing `raw` — the runtime never sees authoring syntax.
  if (obj.raw !== undefined) {
    if (typeof obj.raw !== "string") {
      throw new Error(`${context}.raw: must be a string`);
    }
    normalized.text = tokenizeSegments(obj.raw, `${context}.raw`, linkRegistry);
    delete normalized.raw;
  }

  if (obj.condition !== undefined) normalized.condition = normalizeCondition(obj.condition);
  if (obj.trait !== undefined) normalized.trait = normalizeTrait(obj.trait);
  if (obj.traitNot !== undefined) normalized.traitNot = normalizeTrait(obj.traitNot);
  if (obj.position !== undefined) normalized.position = normalizePositionFilter(obj.position);
  if (obj.affiliation !== undefined) normalized.affiliation = normalizeList(obj.affiliation, normalizeAffiliation);
  if (obj.attribute !== undefined) normalized.attribute = normalizeList(obj.attribute, normalizeAttribute);
  if (obj.rank !== undefined) normalized.rank = normalizeList(obj.rank, normalizeRank);
  if (obj.kind !== undefined) normalized.kind = normalizeKind(obj.kind);
  if (obj.line !== undefined) normalized.line = normalizeLine(obj.line);
  if (obj.series !== undefined) normalized.series = toCode(obj.series);

  // Nested effect nodes: sequence.steps is an array; the rest are single.
  // Each nested node goes through compileNode so its `type` is validated
  // against the catalog at its own source path.
  if (obj.steps !== undefined) {
    if (!Array.isArray(obj.steps)) {
      throw new Error(`${context}.steps: expected an array`);
    }
    normalized.steps = obj.steps.map((step, i) =>
      compileNode(step, `${context}.steps[${i}]`, linkRegistry)
    );
  }
  for (const key of NESTED_NODE_KEYS) {
    if (obj[key] !== undefined) {
      normalized[key] = compileNode(obj[key], `${context}.${key}`, linkRegistry);
    }
  }

  // Descriptor/predicate/trigger objects — recurse only when object-valued
  // (a trigger's `target`/`source` are plain strings, left as-is).
  for (const key of NESTED_DESCRIPTOR_KEYS) {
    if (obj[key] !== undefined && typeof obj[key] === "object") {
      normalized[key] = normalizeEffectObject(obj[key], `${context}.${key}`, linkRegistry);
    }
  }

  const trigger = obj.trigger;
  if (
    trigger && typeof trigger === "object" && !Array.isArray(trigger) &&
    typeof trigger.type === "string" && !CATALOG_TRIGGER_TYPES.has(trigger.type)
  ) {
    throw new Error(
      `${context}.trigger: unknown trigger type "${trigger.type}" — list it in schemas/dsl-catalog.json and both card schemas`
    );
  }
  // `triggers` is the plural form: an effect that fires on more than one event
  // (e.g. a Conduit passive that fires on both round start and activation).
  // Each entry is validated against the trigger catalog and normalized like the
  // singular `trigger`.
  const triggersArr = obj.triggers;
  if (triggersArr !== undefined) {
    if (!Array.isArray(triggersArr)) {
      throw new Error(`${context}.triggers: expected an array`);
    }
    normalized.triggers = triggersArr.map((t, i) => {
      if (!t || typeof t !== "object" || Array.isArray(t)) {
        throw new Error(`${context}.triggers[${i}]: expected a trigger object`);
      }
      if (typeof t.type !== "string" || t.type.trim() === "") {
        throw new Error(`${context}.triggers[${i}]: missing non-empty "type"`);
      }
      if (!CATALOG_TRIGGER_TYPES.has(t.type)) {
        throw new Error(
          `${context}.triggers[${i}]: unknown trigger type "${t.type}" — list it in schemas/dsl-catalog.json and both card schemas`
        );
      }
      return normalizeEffectObject(t, `${context}.triggers[${i}]`, linkRegistry);
    });
  }
  const predicate = obj.if;
  if (
    predicate && typeof predicate === "object" && !Array.isArray(predicate) &&
    typeof predicate.type === "string" && !CATALOG_PREDICATE_TYPES.has(predicate.type)
  ) {
    throw new Error(
      `${context}.if: unknown predicate type "${predicate.type}" — list it in schemas/dsl-catalog.json and both card schemas`
    );
  }

  return normalized;
}

export function compileNode(node, context, linkRegistry = null) {
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`${context}: expected a structured effect object`);
  }
  if (typeof node.type !== "string" || node.type.trim() === "") {
    throw new Error(`${context}: missing non-empty "type"`);
  }
  if (!CATALOG_NODE_TYPES.has(node.type)) {
    throw new Error(
      `${context}: unknown node type "${node.type}" — list it in schemas/dsl-catalog.json and both card schemas before compiling`
    );
  }
  return normalizeEffectObject(node, context, linkRegistry);
}

export function compileEntries(entries, context, linkRegistry = null) {
  return (entries || []).map((entry, i) => compileNode(entry, `${context}[${i}]`, linkRegistry));
}

// ── Transformation trigger compilation ──────────────────────────────────────
// Evolution and ignition triggers are authored as the same structured trigger
// objects passives use (see docs/COMPILED_CARD_DSL.md). The compiler validates
// each entry's `type` against the catalog at its own source path and
// normalizes code-bearing fields; the runtime never sees authoring syntax.

function compileTransformationTriggers(entries, cardName, kind, linkRegistry = null) {
  return (entries || [])
    .filter((entry) => entry !== null && entry !== undefined)
    .map((entry, index) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(
          `${cardName}.${kind}[${index}]: expected a structured trigger object with a "type" and "raw"`
        );
      }
      if (typeof entry.type !== "string" || !CATALOG_TRIGGER_TYPES.has(entry.type)) {
        throw new Error(
          `${cardName}.${kind}[${index}]: unknown trigger type "${entry.type}" — list it in schemas/dsl-catalog.json and both card schemas`
        );
      }
      return normalizeEffectObject(entry, `${cardName}.${kind}[${index}]`, linkRegistry);
    });
}

// ── Requirement compilation ─────────────────────────────────────────────────
// Play/attach requirements are structured check objects (see the requirements
// grammar in docs/COMPILED_CARD_DSL.md). The compiler validates each `type`
// against the catalog and normalizes code-bearing fields; RequirementValidator
// consumes the compiled objects.

function compileRequirements(entries, cardName, linkRegistry = null) {
  return (entries || []).map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(
        `${cardName}.requirements[${index}]: expected a structured requirement object with a "type" and "raw"`
      );
    }
    if (typeof entry.type !== "string" || !CATALOG_REQUIREMENT_TYPES.has(entry.type)) {
      throw new Error(
        `${cardName}.requirements[${index}]: unknown requirement type "${entry.type}" — list it in schemas/dsl-catalog.json and both card schemas`
      );
    }
    return normalizeEffectObject(entry, `${cardName}.requirements[${index}]`, linkRegistry);
  });
}

// ── Cross-reference resolution ──────────────────────────────────────────────

export function resolveEvolveInto(card, allCards, linkRegistry = linkRegistryFor(allCards)) {
  if (card.type !== "unit") return null;
  const evolveTriggers = card.evolve;
  if (!Array.isArray(evolveTriggers) || evolveTriggers.length === 0) return null;

  const current = parseStage(card.name);
  const root = current ? current.root : card.name;
  const stage = current ? current.stage : 1;
  if (stage + 1 > MAX_STAGE) {
    throw new Error(`"${card.name}" is at the maximum evolution stage (${MAX_STAGE}).`);
  }

  const expectedEvolvedName = stageName(root, stage + 1);
  const evolvedCard = allCards.find((c) => c.name === expectedEvolvedName);

  if (!evolvedCard) {
    throw new Error(`Evolution target "${expectedEvolvedName}" for "${card.name}" does not exist.`);
  }
  if (evolvedCard.type !== "unit") {
    throw new Error(`Evolution target "${expectedEvolvedName}" for "${card.name}" must be a unit, got "${evolvedCard.type}".`);
  }

  // Structured trigger objects, validated and normalized
  const triggers = compileTransformationTriggers(evolveTriggers, card.name, "evolve", linkRegistry);

  return {
    triggers,
    cardId: evolvedCard.cardId,
  };
}

export function resolveEvolvedFrom(card, allCards) {
  if (card.type !== "unit") return null;
  const current = parseStage(card.name);
  if (!current) return null;

  const baseName = current.stage === MIN_STAGE
    ? current.root
    : stageName(current.root, current.stage - 1);
  const baseCard = allCards.find((c) => c.name === baseName);
  return baseCard ? baseCard.cardId : null;
}

export function resolveIgniteInto(card, allCards, linkRegistry = linkRegistryFor(allCards)) {
  if (card.type !== "equipment") return null;
  const ignitionTriggers = card.ignition;
  if (!Array.isArray(ignitionTriggers) || ignitionTriggers.length === 0) return null;

  // Convention: "{name} - Ignited"
  const expectedIgnitedName = card.name + " - Ignited";
  const ignitedCard = allCards.find((c) => c.name === expectedIgnitedName);

  if (!ignitedCard) {
    throw new Error(`Ignition target "${expectedIgnitedName}" for "${card.name}" does not exist or is not equipment.`);
  }

  // Structured trigger objects, validated and normalized
  const triggers = compileTransformationTriggers(ignitionTriggers, card.name, "ignition", linkRegistry);

  return {
    triggers,
    cardId: ignitedCard.cardId,
  };
}

export function resolveIgnitedFrom(card, allCards) {
  if (card.type !== "equipment") return null;
  if (!card.name.toLowerCase().includes(" - ignited")) return null;

  const baseName = card.name.replace(/\s*-\s*ignited\s*/i, "").trim();
  const baseCard = allCards.find((c) => c.name === baseName);
  return baseCard ? baseCard.cardId : null;
}

// ── Card compilation ────────────────────────────────────────────────────────

// Deck constraints are structured check objects carrying their own authored
// display text; they tokenize like every other DSL node.
function compileDeckConstraints(constraints, cardName, linkRegistry) {
  return (constraints || []).map((constraint, index) => {
    if (!constraint || typeof constraint !== "object" || Array.isArray(constraint)) {
      throw new Error(`${cardName}.deckConstraints[${index}]: expected an object`);
    }
    const compiled = { ...constraint };
    if (compiled.raw !== undefined) {
      if (typeof compiled.raw !== "string") {
        throw new Error(`${cardName}.deckConstraints[${index}].raw: must be a string`);
      }
      compiled.text = tokenizeSegments(compiled.raw, `${cardName}.deckConstraints[${index}].raw`, linkRegistry);
      delete compiled.raw;
    }
    return compiled;
  });
}

export function compileCard(rawCard, allCards, linkRegistry = linkRegistryFor([rawCard])) {
  const type = rawCard.type;
  const cardName = rawCard.name || "<unnamed>";

  // `entryHp` is a unit-only field (a skill or equipment has no battlefield
  // entry to initialize); JSON Schema cannot express the cross-field bound,
  // so both rejections live here.
  if (rawCard.entryHp !== undefined && rawCard.entryHp !== null && type !== "unit") {
    throw new Error(`${cardName}: "entryHp" is only valid on unit cards`);
  }

  // Base fields (shared by all card types)
  const compiled = {
    cardId: null, // assigned after sorting
    type: type,
    name: rawCard.name || "",
    series: rawCard.series ? toCode(rawCard.series) : null,
    sobriquet: rawCard.sobriquet || null,
    cost: rawCard.cost ?? 0,
    keywords: (rawCard.keywords || []).map(normalizeKeyword),
    deckConstraints: compileDeckConstraints(rawCard.deckConstraints, cardName, linkRegistry),
  };

  if (type === "unit") {
    compiled.hp = rawCard.hp ?? 0;
    if (rawCard.entryHp !== undefined && rawCard.entryHp !== null && rawCard.entryHp > compiled.hp) {
      throw new Error(
        `${cardName}: "entryHp" (${rawCard.entryHp}) cannot exceed "hp" (${compiled.hp}) — a unit cannot enter above its max`
      );
    }
    compiled.entryHp = rawCard.entryHp ?? null;
    compiled.rank = rawCard.rank || null;
    compiled.kind = rawCard.kind ? normalizeKind(rawCard.kind) : "standard";
    compiled.line = rawCard.line ? normalizeLine(rawCard.line) : null;

    // Positions — only the five main positions; special kinds have none.
    compiled.positions = (rawCard.positions || []).map((p) => POSITION_CODES[p.toLowerCase()] || toCode(p));
    compiled.rules = compileEntries(rawCard.rules, `${cardName}.rules`, linkRegistry);

    // Traits — { code, value? } objects (value only present for numeric traits)
    const parsedTraits = (rawCard.traits || [])
      .map(parseTrait)
      .filter(Boolean);
    compiled.traits = parsedTraits.map((t) => {
      if (t.value !== null) return { code: t.code, value: t.value };
      return { code: t.code };
    });

    // Attributes
    compiled.attributes = (rawCard.attributes || []).map(
      (a) => ATTRIBUTE_CODES[a.toLowerCase()] || toCode(a)
    );

    // Affiliations
    compiled.affiliations = (rawCard.affiliations || []).map(toCode);

    // Abilities + passives — structured DSL nodes (same shape as effects)
    compiled.abilities = compileEntries(rawCard.abilities, `${cardName}.abilities`, linkRegistry);
    compiled.passives = compileEntries(rawCard.passives, `${cardName}.passives`, linkRegistry);

    // Evolution (computed after all cards have cardIds)
    compiled._evolveRaw = rawCard.evolve || [];
    compiled.evolveInto = null;
    compiled.evolvedFrom = null;

    // Effects/Requirements not applicable to units
    compiled.requirements = [];
    compiled.effects = [];
    compiled.igniteInto = null;
    compiled.ignitedFrom = null;
  }

  if (type === "skill") {
    compiled.requirements = compileRequirements(rawCard.requirements, cardName, linkRegistry);
    compiled.effects = compileEntries(rawCard.effects, `${cardName}.effects`, linkRegistry);

    // Not applicable to skills
    compiled.hp = null;
    compiled.rank = null;
    compiled.positions = [];
    compiled.traits = [];
    compiled.attributes = [];
    compiled.affiliations = [];
    compiled.abilities = [];
    compiled.passives = [];
    compiled.evolveInto = null;
    compiled.evolvedFrom = null;
    compiled.igniteInto = null;
    compiled.ignitedFrom = null;
  }

  if (type === "equipment") {
    compiled.requirements = compileRequirements(rawCard.requirements, cardName, linkRegistry);
    compiled.effects = compileEntries(rawCard.effects, `${cardName}.effects`, linkRegistry);

    // Ignition (computed after all cards have cardIds)
    compiled._ignitionRaw = rawCard.ignition || [];
    compiled.igniteInto = null;
    compiled.ignitedFrom = null;

    // Not applicable to equipment
    compiled.hp = null;
    compiled.rank = null;
    compiled.positions = [];
    compiled.traits = [];
    compiled.attributes = [];
    compiled.affiliations = [];
    compiled.abilities = [];
    compiled.passives = [];
    compiled.evolveInto = null;
    compiled.evolvedFrom = null;
  }

  return compiled;
}

export function cleanCompiled(card) {
  // Remove internal temporary fields
  delete card._evolveRaw;
  delete card._ignitionRaw;

  // Delete optional single-value fields when null (sparse schema per plan)
  if (card.sobriquet === null) delete card.sobriquet;
  if (card.series === null) delete card.series;
  if (card.rank === null) delete card.rank;
  if (card.hp === null) delete card.hp;
  if (card.entryHp === null) delete card.entryHp;
  if (card.line === null) delete card.line;
  if (card.evolveInto === null) delete card.evolveInto;
  if (card.evolvedFrom === null) delete card.evolvedFrom;
  if (card.igniteInto === null) delete card.igniteInto;
  if (card.ignitedFrom === null) delete card.ignitedFrom;
  if (card.keywords && card.keywords.length === 0) delete card.keywords;
  if (!card.rules || card.rules.length === 0) delete card.rules;

  // Positions are meaningful only for standard units; delete when empty
  // (special kinds and non-unit cards have none).
  if (!card.positions || card.positions.length === 0) delete card.positions;

  // Delete type-inappropriate empty arrays (sparse schema per plan)
  // Unit-only arrays — remove from non-unit cards
  if (card.type !== "unit") {
    if (!card.traits || card.traits.length === 0) delete card.traits;
    if (!card.attributes || card.attributes.length === 0) delete card.attributes;
    if (!card.affiliations || card.affiliations.length === 0) delete card.affiliations;
    if (!card.abilities || card.abilities.length === 0) delete card.abilities;
    if (!card.passives || card.passives.length === 0) delete card.passives;
  }
  // Skill/equipment-only arrays
  if (card.requirements && card.requirements.length === 0) delete card.requirements;
  if (card.effects && card.effects.length === 0) delete card.effects;

  return card;
}

// ── Icon checking ───────────────────────────────────────────────────────────

async function checkIcons(cards) {
  const missingIcons = [];
  const neededIcons = new Set();

  // Collect all trait codes (now objects with .code)
  for (const card of cards) {
    for (const trait of card.traits || []) {
      neededIcons.add(`traits/${trait.code}.png`);
    }
  }

  // Collect all position codes
  for (const card of cards) {
    for (const posCode of card.positions || []) {
      neededIcons.add(`positions/${posCode}.png`);
    }
  }

  // Collect all attribute codes
  for (const card of cards) {
    for (const attrCode of card.attributes || []) {
      neededIcons.add(`attributes/${attrCode}.png`);
    }
  }

  // Conditions - check against known list, now in conditions/ folder
  const conditionCodes = [
    "burned", "cursed", "doomed", "exhausted", "frozen",
    "ghost", "heavy", "poisoned", "rooted", "stunned", "weak",
  ];
  for (const code of conditionCodes) {
    neededIcons.add(`conditions/${code}.png`);
  }

  // Check which files exist
  for (const iconPath of neededIcons) {
    const fullPath = path.join(iconsDir, iconPath);
    try {
      await fs.access(fullPath);
    } catch {
      missingIcons.push(iconPath);
    }
  }

  return missingIcons;
}

// ── Artwork resolution ──────────────────────────────────────────────────────

/**
 * List the slug stems of the top-level artwork files in a directory.
 *
 * Only top-level `.png` files count: `raw/` holds pre-normalization sources
 * and is ignored by construction, as is the pipeline README. A missing
 * directory models as "no artwork exists" rather than a build failure.
 *
 * @param {string} dir - artworks directory
 * @returns {Promise<Set<string>>} filename stems without the .png extension
 */
async function listArtworkStems(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return new Set();
    throw error;
  }
  const stems = new Set();
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".png")) {
      stems.add(entry.name.replace(/\.png$/, ""));
    }
  }
  return stems;
}

/**
 * Warn-only consistency check between compiled cards and artwork files
 * (mirrors checkIcons: reports, never fails).
 *
 * Missing: card slugs with no `<slug>.png` in the artworks directory.
 * Orphans: artwork files whose stem matches no card, which almost always
 * means a filename typo or a renamed card.
 *
 * @param {object[]} cards - cleaned compiled cards
 * @param {string} dir - artworks directory
 * @returns {Promise<{ missing: string[], orphans: string[] }>} slug stems,
 *   sorted, ready to be printed as `<slug>.png`
 */
export async function checkArtworks(cards, dir = artworksDir) {
  const stems = await listArtworkStems(dir);
  const missing = [];
  const cardStems = new Set();
  for (const card of cards) {
    const stem = normalizeName(card.name);
    cardStems.add(stem);
    if (!stems.has(stem)) {
      missing.push(stem);
    }
  }
  const orphans = [...stems].filter((stem) => !cardStems.has(stem)).sort();
  return { missing, orphans };
}

// ── Main ────────────────────────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

/**
 * Compile the source YAML into the final keyed artifact shape **in memory**.
 *
 * This is the non-mutating path used by the data audit and tests: it loads
 * every YAML file, assigns the stable name-sorted cardIds, resolves
 * evolve/ignite cross-references, cleans sparse fields, and validates the
 * result against the compiled schema. It never writes a file.
 *
 * Duplicate card names are a hard failure — a duplicate would make the
 * evolve/ignite lookups and any by-name reference ambiguous, and one keyed
 * artifact entry would silently shadow the other.
 *
 * @returns {Promise<{ output: object, cards: object[], catalogCopy: object, catalogMentions: object }>}
 *   `output` is the cardId-keyed artifact object; `cards` is the same data as
 *   a flat array; the catalog fields are the compiled shared copy and the
 *   per-card inherited mentions they resolve to.
 */
export async function compileCards(options = {}) {
  const {
    cardsDirectory: cardsDir = cardsDirectory,
    compiledSchemaPath: schemaPath = compiledSchemaPath,
    artworksDirectory: artDir = artworksDir,
  } = options;

  // 1. Read all YAML files recursively
  const yamlFiles = await collectCardFiles(cardsDir);

  const rawCards = [];
  const errors = [];

  for (const file of yamlFiles) {
    try {
      const raw = await fs.readFile(file, "utf-8");
      const card = yaml.load(raw);
      if (card && card.type) {
        rawCards.push(card);
      } else {
        errors.push(`${file}: No valid card data found`);
      }
    } catch (err) {
      errors.push(`${file}: YAML parse error - ${err.message}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Errors loading cards:\n${errors.map((e) => `  ${e}`).join("\n")}`);
  }

  // 2. Sort by name for stable cardId assignment
  rawCards.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const seenNames = new Set();
  const duplicateNames = rawCards
    .map((card) => card.name || "")
    .filter((name) => (seenNames.has(name) ? true : (seenNames.add(name), false)));
  if (duplicateNames.length > 0) {
    throw new Error(`Duplicate card names: ${[...new Set(duplicateNames)].join(", ")}`);
  }

  // 3. Assign cardIds
  rawCards.forEach((card, index) => {
    card._tempId = index;
  });

  // 4. First pass: compile all cards with temporary IDs. The link registry
  //    is built once from the whole pool so every text link resolves against
  //    every card and series in it. Shared catalog copy compiles against the
  //    shipped pool as well: its `card:` links name shipped cards, so a
  //    compile over a smaller pool (a test-authored source directory) still
  //    resolves them.
  const linkRegistry = linkRegistryFor(rawCards, shippedLinkRegistry());
  const compiledCards = rawCards.map((raw) => compileCard(raw, rawCards.map((r) => ({
    name: r.name,
    cardId: r._tempId,
  })), linkRegistry));

  // Assign temporary cardIds
  compiledCards.forEach((card, index) => {
    card.cardId = rawCards[index]._tempId;
  });

  // 5. Resolve cross-references (evolve/ignite)
  for (const compiled of compiledCards) {
    const rawCard = rawCards.find((r) => r.name === compiled.name);
    if (!rawCard) continue;

    // Build list of all cards with their IDs for cross-referencing
    const allWithIds = compiledCards.map((c) => ({
      name: c.name,
      cardId: c.cardId,
      type: c.type,
    }));

    // Evolution
    if (compiled.type === "unit" && rawCard.evolve && rawCard.evolve.length > 0) {
      compiled.evolveInto = resolveEvolveInto(
        { ...rawCard, name: compiled.name },
        allWithIds,
        linkRegistry
      );
    }
    compiled.evolvedFrom = resolveEvolvedFrom(
      { ...rawCard, name: compiled.name, type: compiled.type },
      allWithIds
    );

    // Ignition
    if (compiled.type === "equipment" && rawCard.ignition && rawCard.ignition.length > 0) {
      compiled.igniteInto = resolveIgniteInto(
        { ...rawCard, name: compiled.name },
        allWithIds,
        linkRegistry
      );
    }
    compiled.ignitedFrom = resolveIgnitedFrom(
      { ...rawCard, name: compiled.name, type: compiled.type },
      allWithIds
    );
  }

  // 5a. Stamp slugs. The slug is a card's persistent identifier: the runtime
  //     cardId is a name-sorted compile-time index that shifts whenever cards
  //     are added or renamed, so everything persisted outside a running game
  //     (deck collections, starter decks) references cards by slug. A slug
  //     collision would silently merge two cards, so it fails the compile the
  //     same way a duplicate name does. Relations (5b) resolve text links and
  //     machine references through slugs, so they are stamped first.
  const seenSlugs = new Map();
  for (const card of compiledCards) {
    const slug = normalizeName(card.name);
    const owner = seenSlugs.get(slug);
    if (owner !== undefined) {
      throw new Error(`Duplicate card slugs: "${slug}" ("${owner}" and "${card.name}")`);
    }
    seenSlugs.set(slug, card.name);
    card.slug = slug;
  }

  // 5b. Stamp relations. Text links and machine-readable references were
  //     resolved during compilation; the recursive closure needs final
  //     cardIds, so it runs once every cross-reference is in place. A card
  //     also inherits the mentions of the shared catalog copy it carries or
  //     names (attributes, printed traits, positions, conditions it applies,
  //     glossary entries it links), which joins the mention edge as if the
  //     copy were its own.
  const catalogCopy = compileSharedCatalogCopy(linkRegistry);
  const catalogMentions = packageCatalogMentions(compiledCards, rawCards, {
    mentions: buildCatalogMentions(catalogCopy),
  });
  stampRelatedCards(compiledCards, catalogMentions);

  // 6. Clean up temporary fields
  const finalCards = compiledCards.map(cleanCompiled);

  // 7. Stamp artwork paths. The artwork contract binds `<slug>.png` files in
  //    the artworks directory to the card whose name produces that slug (the
  //    same derivation that names the YAML source). Cards without a file stay
  //    fieldless, matching cleanCompiled's sparse optional-field convention;
  //    gaps and orphans are reported by checkArtworks, not failed here.
  //    Slugs were stamped in 5a, so the artwork contract binds against them.
  const artworkStems = await listArtworkStems(artDir);
  for (const card of finalCards) {
    const stem = normalizeName(card.name);
    if (artworkStems.has(stem)) {
      card.artworkPath = `/assets/images/artworks/${stem}.png`;
    }
  }

  // 8. Convert to keyed object (by cardId as string), failing on any
  //    identity collision instead of silently shadowing an entry.
  const output = {};
  for (const card of finalCards) {
    const key = String(card.cardId);
    if (Object.prototype.hasOwnProperty.call(output, key)) {
      throw new Error(`Duplicate compiled cardId: ${key} ("${card.name}")`);
    }
    output[key] = card;
  }

  const compiledSchema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateCompiled = ajv.compile(compiledSchema);

  if (!validateCompiled(output)) {
    const details = (validateCompiled.errors || [])
      .map((error) => `${error.instancePath || "output"}: ${error.message}`)
      .join("\n  ");
    throw new Error(`Compiled card data failed ${path.relative(projectRoot, schemaPath)}:\n  ${details}`);
  }

  return { output, cards: finalCards, catalogCopy, catalogMentions };
}

export async function compileAll(options = {}) {
  const {
    cardsDirectory: cardsDir = cardsDirectory,
    outputPath: outPath = outputPath,
    runValidate = true,
    artworksDirectory: artDir = artworksDir,
    // The compiled catalog copy is a peer artifact of the card catalog, so the
    // two are written from the same run. A caller that redirects `outputPath`
    // (a test compiling into a temp directory) must redirect these too, or it
    // would overwrite the checked-in artifacts.
    catalogCopyPath: copyPath = catalogCopyPath,
    catalogMentionsPath: mentionsPath = catalogMentionsPath,
  } = options;

  // Source YAML is the only authoring input. Never compile unvalidated cards.
  if (runValidate) {
    execFileSync(process.execPath, [validatorPath], {
      cwd: projectRoot,
      stdio: "inherit",
    });
  }

  const { output, cards: finalCards, catalogCopy, catalogMentions } = await compileCards({
    cardsDirectory: cardsDir,
    compiledSchemaPath: options.compiledSchemaPath,
    artworksDirectory: artDir,
  });

  // Write output. The compiled catalog copy is a peer artifact of the card
  // catalog and ships from the same run, so the two can never drift.
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  await fs.mkdir(path.dirname(copyPath), { recursive: true });
  await fs.writeFile(copyPath, serializeArtifact(catalogCopy), "utf-8");
  await fs.writeFile(mentionsPath, serializeArtifact(catalogMentions), "utf-8");

  // Check icons
  const missingIcons = await checkIcons(finalCards);

  // Check artwork coverage (warn-only, like icons)
  const { missing: missingArtworks, orphans: orphanArtworks } = await checkArtworks(finalCards, artDir);

  // Report
  console.log(`${colors.green}✓ Compiled ${finalCards.length} cards to ${path.relative(projectRoot, outPath)}${colors.reset}`);
  console.log(
    `  Shared catalog copy: ${path.relative(projectRoot, copyPath)} ` +
      `(${Object.keys(catalogMentions).length} cards inherit mentions)`
  );

  const units = finalCards.filter((c) => c.type === "unit").length;
  const skills = finalCards.filter((c) => c.type === "skill").length;
  const equipment = finalCards.filter((c) => c.type === "equipment").length;
  console.log(`  Units: ${units}  Skills: ${skills}  Equipment: ${equipment}`);

  const evolveCount = finalCards.filter((c) => c.evolveInto).length;
  const igniteCount = finalCards.filter((c) => c.igniteInto).length;
  if (evolveCount > 0) console.log(`  Evolution chains: ${evolveCount}`);
  if (igniteCount > 0) console.log(`  Ignition chains: ${igniteCount}`);

  if (missingIcons.length > 0) {
    console.log(`\n${colors.yellow}⚠ Missing ${missingIcons.length} icon(s):${colors.reset}`);
    missingIcons.forEach((icon) => console.log(`  - ${icon}`));
  }

  if (missingArtworks.length > 0) {
    console.log(`\n${colors.yellow}⚠ Missing ${missingArtworks.length} artwork(s):${colors.reset}`);
    missingArtworks.forEach((slug) => console.log(`  - ${slug}.png`));
  }

  if (orphanArtworks.length > 0) {
    console.log(`\n${colors.yellow}⚠ Unmatched ${orphanArtworks.length} artwork file(s):${colors.reset}`);
    orphanArtworks.forEach((slug) => console.log(`  - ${slug}.png`));
  }

  return finalCards;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  compileAll().catch((error) => {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exitCode = 1;
  });
}

