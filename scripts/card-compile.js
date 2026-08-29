import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

import { collectCardFiles } from "./lib/collect-card-files.js";
import dslCatalog from "../schemas/dsl-catalog.json" with { type: "json" };

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const cardsDirectory = path.join(projectRoot, "data", "cards");
const outputPath = path.join(projectRoot, "server", "data", "cards.json");
const iconsDir = path.join(projectRoot, "public", "assets", "icons");
const validatorPath = path.join(projectRoot, "scripts", "card-validate.js");
const compiledSchemaPath = path.join(projectRoot, "schemas", "compiled-cards.schema.json");

// ── Code mapping helpers ────────────────────────────────────────────────────

function toCode(str) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// Position display name → internal code
const positionCodeMap = {
  "fisherman": "fisherman",
  "light bearer": "light-bearer",
  "scout": "scout",
  "spear bearer": "spear-bearer",
  "wave controller": "wave-controller",
};

// Attribute display name → internal code
const attributeCodeMap = {
  "anima": "anima",
  "silver dwarf": "silver-dwarf",
  "red witch": "red-witch",
  "hwayeomsa": "hwayeomsa",
  "jeonsulsa": "jeonsulsa",
  "irregular": "irregular",
  "living ignition weapon": "living-ignition-weapon",
};

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

function normalizePosition(value) {
  if (value === null) return null;
  const str = String(value);
  return positionCodeMap[str.toLowerCase()] || toCode(str);
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

function normalizeAttribute(value) {
  const str = String(value);
  return attributeCodeMap[str.toLowerCase()] || toCode(str);
}

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

export function normalizeEffectObject(obj, context) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error(`${context}: expected an object`);
  }

  const normalized = { ...obj };

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
      compileNode(step, `${context}.steps[${i}]`)
    );
  }
  for (const key of NESTED_NODE_KEYS) {
    if (obj[key] !== undefined) {
      normalized[key] = compileNode(obj[key], `${context}.${key}`);
    }
  }

  // Descriptor/predicate/trigger objects — recurse only when object-valued
  // (a trigger's `target`/`source` are plain strings, left as-is).
  for (const key of NESTED_DESCRIPTOR_KEYS) {
    if (obj[key] !== undefined && typeof obj[key] === "object") {
      normalized[key] = normalizeEffectObject(obj[key], `${context}.${key}`);
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
      return normalizeEffectObject(t, `${context}.triggers[${i}]`);
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

export function compileNode(node, context) {
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
  return normalizeEffectObject(node, context);
}

export function compileEntries(entries, context) {
  return (entries || []).map((entry, i) => compileNode(entry, `${context}[${i}]`));
}

// ── Trigger parsing ─────────────────────────────────────────────────────────
// Converts raw trigger text into typed ASTs so the runtime never parses raw.
// Unsupported triggers fail compilation until the pattern is modeled here.

export function parseTrigger(raw) {
  const text = String(raw).trim();
  if (!text) return null;

  // "i am equipped with X"
  const equipMatch = /^i am equipped with (.+)$/i.exec(text);
  if (equipMatch) {
    return { type: "equip", cardName: equipMatch[1].trim() };
  }

  // "i have X, Y and Z equipped" (all-equipped evolution/ignition trigger)
  const allEquipMatch = /^i have (.+?) equipped$/i.exec(text);
  if (allEquipMatch) {
    const cardNames = allEquipMatch[1]
      .split(/\s+and\s+|\s*,\s*/i)
      .map((name) => name.trim())
      .filter(Boolean);
    return { type: "has_all_equipped", cardNames };
  }

  // "the bearer Slays a unit"
  const slayMatch = /^the bearer slays (?:a |an )?(.+)$/i.exec(text);
  if (slayMatch) {
    return { type: "slay", target: slayMatch[1].trim().toLowerCase() };
  }

  // "when i am deployed"
  if (/^when i am deployed$/i.test(text)) {
    return { type: "deploy" };
  }

  // "when i kill a <rank>"
  const killRankMatch = /^when i kill (?:a |an )(.+)$/i.exec(text);
  if (killRankMatch) {
    return { type: "kill", rank: killRankMatch[1].trim().toLowerCase() };
  }

  // "when i kill a unit"
  if (/^when i kill (?:a |an )?unit$/i.test(text)) {
    return { type: "kill", target: "unit" };
  }

  // "when an ally dies"
  if (/^when (?:another )?ally dies$/i.test(text)) {
    return { type: "ally_dies" };
  }

  // "when i am damaged by X"
  const damagedByMatch = /^when i am damaged by (.+)$/i.exec(text);
  if (damagedByMatch) {
    return { type: "damaged_by", source: damagedByMatch[1].trim().toLowerCase() };
  }

  // "when I am given X" / "X is played on me"
  const givenMatch = /^when i am given (.+)$/i.exec(text);
  if (givenMatch) {
    return { type: "given", item: givenMatch[1].trim() };
  }
  const playedOnMeMatch = /^(.+?) is played on me$/i.exec(text);
  if (playedOnMeMatch) {
    return { type: "given", item: playedOnMeMatch[1].trim() };
  }

  // "round start" 
  if (/^round start$/i.test(text)) return { type: "round_start" };

  // "activation"
  if (/^activation$/i.test(text)) return { type: "activation" };
  
  // "round end"
  if (/^round end$/i.test(text)) return { type: "round_end" };

  // "when i deal damage"
  if (/^when i deal damage$/i.test(text)) return { type: "deal_damage" };

  // "when I use an ability"
  if (/^when i use an ability$/i.test(text)) return { type: "ability_used" };

  // "Fisherman: equip with X" / "equip with X" (position-scoped or bare)
  const posEquipMatch = /^(?:([a-z ]+):\s*)?equip with (.+)$/i.exec(text);
  if (posEquipMatch) {
    const result = { type: "equip", cardName: posEquipMatch[2].trim() };
    if (posEquipMatch[1]) {
      const posName = posEquipMatch[1].trim().toLowerCase();
      if (positionCodeMap[posName]) {
        result.position = positionCodeMap[posName];
      }
    }
    return result;
  }

  // Unknown trigger — fail compilation so it gets modeled
  return null;
}

// ── Cross-reference resolution ──────────────────────────────────────────────

export function resolveEvolveInto(card, allCards) {
  if (card.type !== "unit") return null;
  const evolveTriggers = card.evolve;
  if (!Array.isArray(evolveTriggers) || evolveTriggers.length === 0) return null;

  // Convention: "{name} - Evolved"
  const expectedEvolvedName = card.name + " - Evolved";
  const evolvedCard = allCards.find((c) => c.name === expectedEvolvedName);

  if (!evolvedCard) {
    throw new Error(`Evolution target "${expectedEvolvedName}" for "${card.name}" does not exist or is not a unit.`);
  }

  // Build typed trigger ASTs from evolve list
  const triggers = evolveTriggers
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => {
      const parsed = parseTrigger(t);
      if (!parsed) {
        throw new Error(
          `Unsupported evolution trigger "${t}" on card "${card.name}". ` +
          `Add its pattern to parseTrigger() in card-compile.js.`
        );
      }
      return { ...parsed, raw: t };
    });

  return {
    triggers,
    cardId: evolvedCard.cardId,
  };
}

export function resolveEvolvedFrom(card, allCards) {
  if (card.type !== "unit") return null;
  // Check if this is an evolved card: name contains " - Evolved"
  if (!card.name.toLowerCase().includes(" - evolved")) return null;

  const baseName = card.name.replace(/\s*-\s*evolved\s*/i, "").trim();
  const baseCard = allCards.find((c) => c.name === baseName);
  return baseCard ? baseCard.cardId : null;
}

export function resolveIgniteInto(card, allCards) {
  if (card.type !== "equipment") return null;
  const ignitionTriggers = card.ignition;
  if (!Array.isArray(ignitionTriggers) || ignitionTriggers.length === 0) return null;

  // Convention: "{name} - Ignited"
  const expectedIgnitedName = card.name + " - Ignited";
  const ignitedCard = allCards.find((c) => c.name === expectedIgnitedName);

  if (!ignitedCard) {
    throw new Error(`Ignition target "${expectedIgnitedName}" for "${card.name}" does not exist or is not equipment.`);
  }

  // Build typed trigger ASTs from ignition list
  const triggers = ignitionTriggers
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => {
      const parsed = parseTrigger(t);
      if (!parsed) {
        throw new Error(
          `Unsupported ignition trigger "${t}" on card "${card.name}". ` +
          `Add its pattern to parseTrigger() in card-compile.js.`
        );
      }
      return { ...parsed, raw: t };
    });

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

export function compileCard(rawCard, allCards) {
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
    deckConstraints: (rawCard.deckConstraints || []).map((constraint) => ({ ...constraint })),
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
    compiled.positions = (rawCard.positions || []).map((p) => positionCodeMap[p.toLowerCase()] || toCode(p));
    compiled.rules = compileEntries(rawCard.rules, `${cardName}.rules`);

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
      (a) => attributeCodeMap[a.toLowerCase()] || toCode(a)
    );

    // Affiliations
    compiled.affiliations = (rawCard.affiliations || []).map(toCode);

    // Abilities + passives — structured DSL nodes (same shape as effects)
    compiled.abilities = compileEntries(rawCard.abilities, `${cardName}.abilities`);
    compiled.passives = compileEntries(rawCard.passives, `${cardName}.passives`);

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
    compiled.requirements = rawCard.requirements || [];
    compiled.effects = compileEntries(rawCard.effects, `${cardName}.effects`);

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
    compiled.requirements = rawCard.requirements || [];
    compiled.effects = compileEntries(rawCard.effects, `${cardName}.effects`);

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
 * @returns {Promise<{ output: object, cards: object[] }>} `output` is the
 *   cardId-keyed artifact object; `cards` is the same data as a flat array.
 */
export async function compileCards(options = {}) {
  const {
    cardsDirectory: cardsDir = cardsDirectory,
    compiledSchemaPath: schemaPath = compiledSchemaPath,
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

  // 4. First pass: compile all cards with temporary IDs
  const compiledCards = rawCards.map((raw) => compileCard(raw, rawCards.map((r) => ({
    name: r.name,
    cardId: r._tempId,
  }))));

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
    }));

    // Evolution
    if (compiled.type === "unit" && rawCard.evolve && rawCard.evolve.length > 0) {
      compiled.evolveInto = resolveEvolveInto(
        { ...rawCard, name: compiled.name },
        allWithIds
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
        allWithIds
      );
    }
    compiled.ignitedFrom = resolveIgnitedFrom(
      { ...rawCard, name: compiled.name, type: compiled.type },
      allWithIds
    );
  }

  // 6. Clean up temporary fields
  const finalCards = compiledCards.map(cleanCompiled);

  // 7. Convert to keyed object (by cardId as string), failing on any
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

  return { output, cards: finalCards };
}

export async function compileAll(options = {}) {
  const {
    cardsDirectory: cardsDir = cardsDirectory,
    outputPath: outPath = outputPath,
    runValidate = true,
  } = options;

  // Source YAML is the only authoring input. Never compile unvalidated cards.
  if (runValidate) {
    execFileSync(process.execPath, [validatorPath], {
      cwd: projectRoot,
      stdio: "inherit",
    });
  }

  const { output, cards: finalCards } = await compileCards({
    cardsDirectory: cardsDir,
    compiledSchemaPath: options.compiledSchemaPath,
  });

  // Write output
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  // Check icons
  const missingIcons = await checkIcons(finalCards);

  // Report
  console.log(`${colors.green}✓ Compiled ${finalCards.length} cards to ${path.relative(projectRoot, outPath)}${colors.reset}`);

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
