import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

import { collectCardFiles } from "./lib/collect-card-files.js";
import conditions from "../server/data/conditions.json" with { type: "json" };

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const cardsDirectory = path.join(projectRoot, "data", "cards");
const schemaPath = path.join(projectRoot, "schemas", "card.schema.json");

/**
 * Source-card validator.
 *
 * This script validates YAML authoring files in data/cards/ only. It does not
 * validate server/data/cards.json. The compiler invokes this script first and
 * must stop if source validation fails. JSON output validation belongs to the
 * compiler because it owns the compiled representation.
 */

// ── Domain data (mirrors RULES.md) ──────────────────────────────────────────

const rankCostRanges = {
  regular: [0, 5],
  ranker: [3, 7],
  "high ranker": [5, 10],
};

const traitNames = new Set([
  "barrier", "beacon", "bloodthirsty", "dealer", "immune",
  "last one standing", "lethal", "pierce", "reflect", "regenerate",
  "resilient", "ruthless", "sharpshooter", "strong", "taunt", "undying", "vengeful",
]);

const traitNamesWithNumericValue = new Set([
  "dealer", "last one standing", "pierce", "reflect",
  "regenerate", "resilient", "ruthless", "strong", "vengeful",
]);

const allowedPositions = new Set([
  "fisherman", "light bearer", "scout", "spear bearer", "wave controller",
]);

const allowedKinds = new Set(["standard", "shinheuh", "landmark", "conduit"]);

const allowedAttributes = new Set([
  "anima", "silver dwarf", "red witch", "hwayeomsa",
  "jeonsulsa", "irregular", "living ignition weapon",
]);

const allowedConditions = new Set(Object.keys(conditions));

const ruleTypes = new Set([
  "disable_passives", "prevent_evolve", "prevent_equip",
  "grant_global_trait", "grant_global_condition", "condition_stack_cap",
]);

const allowedAffiliations = new Set([
  "team aka", "team baam", "team bero", "team chang",
  "team fug", "team khel hellam", "team novick", "team rachel",
  "team sachi", "team ship", "team sweet and sour",
  "khun's team", "fug", "hidden grove", "karaka's servants",
  "revolution", "wolhaiksong", "zahard's army", "zahard's princesses",
  "great warriors", "shining ones", "arie family", "khun family", "ha family",
  "tu perie family", "eurasia family", "po bidau family", "yeon family",
  "ari family", "lo po bia family", "hendo lok family", "blitz family",
  "grand family", "edrok family", "mule family", "nissam family",
  "canines", "data humans", "prince of the redlight district",
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

function addError(errors, field, message) {
  errors.push(`${field}: ${message}`);
}

function addWarning(warnings, field, message) {
  warnings.push(`[WARN] ${field}: ${message}`);
}

function normalizeName(rawName) {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

// Normalize null/undefined to empty array for YAML null fields
function ensureArray(value) {
  if (value === null || value === undefined) return [];
  return value;
}

function normalizeCardForSchema(card) {
  const normalized = { ...card };
  const arrayFields = [
    "positions", "passives", "abilities", "evolve", "traits", "attributes",
    "affiliations", "requirements", "effects", "ignition", "keywords", "deckConstraints",
    "rules",
  ];

  for (const field of arrayFields) {
    if (normalized[field] === null || normalized[field] === undefined) {
      normalized[field] = [];
    }
  }

  // `kind` defaults to "standard" when omitted so the schema's per-kind
  // discrimination always sees an explicit value.
  if (normalized.kind === null || normalized.kind === undefined || normalized.kind === "") {
    normalized.kind = "standard";
  } else {
    normalized.kind = String(normalized.kind).trim().toLowerCase();
  }

  return normalized;
}

// ── Find and load cards ─────────────────────────────────────────────────────

async function findCardFiles() {
  return collectCardFiles(cardsDirectory);
}

async function loadCard(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const card = yaml.load(raw);
    return { card, errors: [] };
  } catch (err) {
    return { card: null, errors: [`YAML parse error: ${err.message}`] };
  }
}

async function loadSchemaValidator() {
  const schema = JSON.parse(await fs.readFile(schemaPath, "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

// ── Build card name → filename index for cross-referencing ──────────────────

async function buildCardNameIndex() {
  const cardFiles = await findCardFiles();
  const index = new Map(); // normalized name → { filename, card }
  for (const cardFile of cardFiles) {
    const { card, errors } = await loadCard(cardFile);
    if (card && card.name && errors.length === 0) {
      const normName = normalizeName(card.name);
      index.set(normName, { filename: path.basename(cardFile), card });
    }
  }
  return index;
}

// ── Validators ──────────────────────────────────────────────────────────────

function validateFilename(card, filename, warnings) {
  if (!card.name) return;
  const expectedFilename = normalizeName(card.name) + ".yml";
  if (filename !== expectedFilename) {
    addWarning(warnings, "filename", `expected "${expectedFilename}" but file is "${filename}"`);
  }
}

function validateTraits(values, errors) {
  const seen = new Set();

  values.forEach((value, index) => {
    const str = String(value).trim();
    const match = /^(.+?)(?:\s+(\d+))?$/i.exec(str);
    if (!match) {
      addError(errors, `traits[${index}]`, `invalid trait format: "${str}"`);
      return;
    }

    const traitName = match[1].toLowerCase();
    const traitNumber = match[2] ? parseInt(match[2], 10) : undefined;

    if (!traitNames.has(traitName)) {
      addError(errors, `traits[${index}]`, `"${traitName}" is not a valid trait. Must be one of: ${[...traitNames].join(", ")}`);
      return;
    }

    if (traitNumber !== undefined && traitNumber < 1) {
      addError(errors, `traits[${index}]`, `numeric value must be a positive integer`);
    }

    if (seen.has(traitName)) {
      addError(errors, `traits[${index}]`, `duplicate trait "${traitName}"`);
    }

    seen.add(traitName);
  });
}

function validatePositions(positions, errors) {
  const seen = new Set();

  positions.forEach((pos, index) => {
    const posLower = pos.toLowerCase();
    if (!allowedPositions.has(posLower)) {
      addError(errors, `positions[${index}]`, `"${pos}" is not a valid position. Must be one of: ${[...allowedPositions].join(", ")}`);
    }
    if (seen.has(posLower)) {
      addError(errors, `positions[${index}]`, `duplicate position "${pos}"`);
    }
    seen.add(posLower);
  });
}

function validateRules(rules, errors) {
  rules.forEach((rule, index) => {
    const field = `rules[${index}]`;
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      addError(errors, field, "must be an object");
      return;
    }
    if (typeof rule.type !== "string" || !ruleTypes.has(rule.type)) {
      addError(errors, `${field}.type`, `"${rule.type}" is not a valid rule type. Must be one of: ${[...ruleTypes].join(", ")}`);
      return;
    }
    if (typeof rule.raw !== "string" || rule.raw.trim().length === 0) {
      addError(errors, `${field}.raw`, "must be a non-empty string");
    }

    if (rule.type === "grant_global_trait") {
      if (typeof rule.trait !== "string" || !traitNames.has(rule.trait.toLowerCase())) {
        addError(errors, `${field}.trait`, `"${rule.trait}" is not a valid trait`);
      }
    } else if (rule.trait !== undefined) {
      addError(errors, `${field}.trait`, `only grant_global_trait declares a trait (got ${rule.type})`);
    }

    if (rule.type === "grant_global_condition") {
      if (typeof rule.condition !== "string" || !allowedConditions.has(rule.condition.toLowerCase())) {
        addError(errors, `${field}.condition`, `"${rule.condition}" is not a valid condition`);
      }
    } else if (rule.condition !== undefined) {
      addError(errors, `${field}.condition`, `only grant_global_condition declares a condition (got ${rule.type})`);
    }

    if (rule.type === "condition_stack_cap") {
      if (!Number.isInteger(rule.cap) || rule.cap < 1) {
        addError(errors, `${field}.cap`, "must be a positive integer");
      }
    } else if (rule.cap !== undefined) {
      addError(errors, `${field}.cap`, `only condition_stack_cap declares a cap (got ${rule.type})`);
    }

    if (rule.position !== undefined) {
      if (rule.type === "condition_stack_cap") {
        addError(errors, `${field}.position`, `${rule.type} does not support a position scope`);
      } else {
        const posLower = String(rule.position).toLowerCase();
        if (posLower !== "chosen" && !allowedPositions.has(posLower)) {
          addError(errors, `${field}.position`, `"${rule.position}" is not a valid position (must be a main position or "chosen")`);
        }
      }
    }
  });
}

function validateAttributes(attributes, errors) {
  const seen = new Set();
  attributes.forEach((attr, index) => {
    const attrLower = attr.toLowerCase();
    if (!allowedAttributes.has(attrLower)) {
      addError(errors, `attributes[${index}]`, `"${attr}" is not a valid attribute`);
    }
    if (seen.has(attrLower)) {
      addError(errors, `attributes[${index}]`, `duplicate attribute "${attr}"`);
    }
    seen.add(attrLower);
  });
}

function validateAffiliations(affiliations, errors) {
  const seen = new Set();
  affiliations.forEach((aff, index) => {
    const affLower = aff.toLowerCase();
    if (!allowedAffiliations.has(affLower)) {
      addError(errors, `affiliations[${index}]`, `"${aff}" is not a recognized affiliation`);
    }
    if (seen.has(affLower)) {
      addError(errors, `affiliations[${index}]`, `duplicate affiliation "${aff}"`);
    }
    seen.add(affLower);
  });
}

function validateKeywords(keywords, errors) {
  const seen = new Set();
  keywords.forEach((keyword, index) => {
    let code;
    if (typeof keyword === "string") {
      code = keyword.trim();
      if (code.length === 0) {
        addError(errors, `keywords[${index}]`, "must be a non-empty string");
        return;
      }
    } else if (keyword && typeof keyword === "object" && typeof keyword.code === "string") {
      code = keyword.code.trim();
      if (code.length === 0) {
        addError(errors, `keywords[${index}]`, "code must be a non-empty string");
        return;
      }
      if (typeof keyword.raw !== "string" || keyword.raw.trim().length === 0) {
        addError(errors, `keywords[${index}]`, "raw must be a non-empty string");
        return;
      }
    } else {
      addError(errors, `keywords[${index}]`, 'must be a non-empty string or an object with "code" and "raw"');
      return;
    }
    const key = code.toLowerCase();
    if (seen.has(key)) {
      addError(errors, `keywords[${index}]`, `duplicate keyword "${code}"`);
    }
    seen.add(key);
  });
}

function validateDeckConstraints(constraints, errors) {
  const seen = new Set();
  constraints.forEach((constraint, index) => {
    if (!constraint || typeof constraint !== "object" || typeof constraint.type !== "string") {
      addError(errors, `deckConstraints[${index}]`, 'must be an object with a string "type"');
      return;
    }
    if (seen.has(constraint.type)) {
      addError(errors, `deckConstraints[${index}]`, `duplicate constraint type "${constraint.type}"`);
    }
    seen.add(constraint.type);
  });
}

function validateRankAndCost(card, errors, kind) {
  const rank = card.rank;

  if (kind !== "standard") {
    if (rank !== null && rank !== undefined && rank !== "") {
      addError(errors, "rank", `must be null/empty for ${kind} units`);
    }
    return;
  }

  if (rank === null || rank === undefined || rank === "") {
    addError(errors, "rank", "must not be null/empty for standard units");
    return;
  }

  const rankLower = rank.toLowerCase();
  if (!rankCostRanges[rankLower]) {
    addError(errors, "rank", `"${rank}" is not a valid rank. Must be one of: ${Object.keys(rankCostRanges).join(", ")}`);
    return;
  }

  if (!Number.isInteger(card.cost)) return;

  const [minCost, maxCost] = rankCostRanges[rankLower];
  if (card.cost < minCost || card.cost > maxCost) {
    addError(errors, "cost", `${rankLower} units must cost between ${minCost} and ${maxCost} (got ${card.cost})`);
  }
}

function validateEvolve(evolveList, errors) {
  if (!Array.isArray(evolveList)) return;
  if (evolveList.length === 0) return; // empty means no evolution, valid

  evolveList.forEach((trigger, index) => {
    if (typeof trigger !== "string" || trigger.trim().length === 0) {
      addError(errors, `evolve[${index}]`, "evolution trigger must be a non-empty string");
    }
  });
}

function validateIgnition(ignitionList, errors) {
  if (!Array.isArray(ignitionList)) return;
  if (ignitionList.length === 0) return; // empty means no ignition, valid

  ignitionList.forEach((trigger, index) => {
    if (typeof trigger !== "string" || trigger.trim().length === 0) {
      addError(errors, `ignition[${index}]`, "ignition trigger must be a non-empty string");
    }
  });
}

// ── Cross-reference validator (runs after all cards loaded) ─────────────────

function validateCrossReferences(allCards, failuresByFile) {
  // Build map: normalized name → card info
  const nameToFile = new Map();
  for (const { filename, card } of allCards) {
    if (card && card.name) {
      nameToFile.set(card.name, { filename, card });
    }
  }

  for (const { filename, relativePath, card } of allCards) {
    if (!card) continue;
    const fileErrors = failuresByFile.get(relativePath) || [];

    // Check evolve references for units
    if (card.type === "unit" && Array.isArray(card.evolve) && card.evolve.length > 0) {
      const targetName = `${card.name} - Evolved`;
      const target = nameToFile.get(targetName);
      if (!target || target.card.type !== "unit") {
        fileErrors.push(`evolve: target card "${targetName}" does not exist`);
      }
    }

    if (card.type === "equipment" && Array.isArray(card.ignition) && card.ignition.length > 0) {
      const targetName = `${card.name} - Ignited`;
      const target = nameToFile.get(targetName);
      if (!target || target.card.type !== "equipment") {
        fileErrors.push(`ignition: target card "${targetName}" does not exist`);
      }
    }

    if (fileErrors.length > 0 && !failuresByFile.has(relativePath)) {
      failuresByFile.set(relativePath, fileErrors);
    }
  }
}

// ── Unit validator ──────────────────────────────────────────────────────────

function validateUnit(card) {
  const errors = [];
  const warnings = [];

  if (typeof card.name !== "string" || card.name.trim().length === 0) {
    addError(errors, "name", "must be a non-empty string");
  }

  if (!Number.isInteger(card.cost)) {
    addError(errors, "cost", `must be an integer (got ${typeof card.cost})`);
  }

  if (!Number.isInteger(card.hp) || card.hp < 1) {
    addError(errors, "hp", `must be a positive integer (got ${card.hp})`);
  }

  const kind = (card.kind && String(card.kind).trim().toLowerCase()) || "standard";
  if (!allowedKinds.has(kind)) {
    addError(errors, "kind", `"${kind}" is not a valid kind. Must be one of: ${[...allowedKinds].join(", ")}`);
  }

  const positions = ensureArray(card.positions);
  if (kind === "standard") {
    if (positions.length === 0) {
      addError(errors, "positions", "must be a non-empty array for standard units");
    } else {
      validatePositions(positions, errors);
    }
  } else if (positions.length > 0) {
    addError(errors, "positions", `must be empty for ${kind} units`);
  }

  validateRankAndCost(card, errors, kind);

  const line = card.line;
  if (kind === "shinheuh") {
    if (!line || !["frontline", "backline"].includes(String(line).trim().toLowerCase())) {
      addError(errors, "line", "shinheuh units must declare a line of frontline or backline");
    }
  } else if (line !== null && line !== undefined && line !== "") {
    addError(errors, "line", `only shinheuh units declare a line (got ${kind})`);
  }

  const traits = ensureArray(card.traits);
  validateTraits(traits, errors);

  const attributes = ensureArray(card.attributes);
  validateAttributes(attributes, errors);

  const affiliations = ensureArray(card.affiliations);
  validateAffiliations(affiliations, errors);

  // passives, abilities, evolve, rules can be empty — just validate they're arrays when present
  if (card.passives !== null && card.passives !== undefined && !Array.isArray(card.passives)) {
    addError(errors, "passives", "must be an array");
  }

  if (card.abilities !== null && card.abilities !== undefined && !Array.isArray(card.abilities)) {
    addError(errors, "abilities", "must be an array");
  }

  if (card.rules !== null && card.rules !== undefined && !Array.isArray(card.rules)) {
    addError(errors, "rules", "must be an array");
  }

  const abilities = ensureArray(card.abilities);
  if ((kind === "landmark" || kind === "conduit") && abilities.length > 0) {
    addError(errors, "abilities", `${kind} units cannot have abilities`);
  }

  const evolve = ensureArray(card.evolve);
  if (kind !== "standard" && evolve.length > 0) {
    addError(errors, "evolve", `${kind} units cannot evolve`);
  }
  validateEvolve(evolve, errors);

  const rules = ensureArray(card.rules);
  if (kind !== "landmark" && rules.length > 0) {
    addError(errors, "rules", `only landmark units declare rules (got ${kind})`);
  } else if (kind === "landmark") {
    validateRules(rules, errors);
  }

  if (kind === "conduit") {
    const constraints = ensureArray(card.deckConstraints);
    if (!constraints.some((c) => c && c.type === "unreachable")) {
      addError(errors, "deckConstraints", "conduit units must be Unreachable");
    }
  }

  // Push warnings as errors for now (they'll display)
  errors.push(...warnings);
  return errors;
}

// ── Skill validator ─────────────────────────────────────────────────────────

function validateSkill(card) {
  const errors = [];
  const warnings = [];

  if (typeof card.name !== "string" || card.name.trim().length === 0) {
    addError(errors, "name", "must be a non-empty string");
  }

  if (!Number.isInteger(card.cost)) {
    addError(errors, "cost", `must be an integer (got ${typeof card.cost})`);
  }

  if (card.requirements !== null && card.requirements !== undefined && !Array.isArray(card.requirements)) {
    addError(errors, "requirements", "must be an array");
  }

  const effects = ensureArray(card.effects);
  if (effects.length === 0) {
    addError(errors, "effects", "must be a non-empty array");
  }

  errors.push(...warnings);
  return errors;
}

// ── Equipment validator ─────────────────────────────────────────────────────

function validateEquipment(card) {
  const errors = [];
  const warnings = [];

  if (typeof card.name !== "string" || card.name.trim().length === 0) {
    addError(errors, "name", "must be a non-empty string");
  }

  if (!Number.isInteger(card.cost)) {
    addError(errors, "cost", `must be an integer (got ${typeof card.cost})`);
  }

  if (card.requirements !== null && card.requirements !== undefined && !Array.isArray(card.requirements)) {
    addError(errors, "requirements", "must be an array");
  }

  const effects = ensureArray(card.effects);
  if (effects.length === 0) {
    addError(errors, "effects", "must be a non-empty array");
  }

  const ignition = ensureArray(card.ignition);
  validateIgnition(ignition, errors);

  errors.push(...warnings);
  return errors;
}

// ── Master validator ────────────────────────────────────────────────────────

const allowedTypes = new Set(["unit", "skill", "equipment"]);

export function validateCard(card, filename) {
  const errors = [];
  const warnings = [];

  if (!card || typeof card !== "object") {
    addError(errors, "card", "must be a YAML object");
    return errors;
  }

  const type = card.type;
  if (!type || !allowedTypes.has(type)) {
    addError(errors, "type", `must be one of: ${[...allowedTypes].join(", ")} (got "${type}")`);
    return errors;
  }

  let typeErrors;
  if (type === "unit") {
    typeErrors = validateUnit(card);
  } else if (type === "skill") {
    typeErrors = validateSkill(card);
  } else if (type === "equipment") {
    typeErrors = validateEquipment(card);
  }

  errors.push(...typeErrors);
  validateKeywords(ensureArray(card.keywords), errors);
  validateDeckConstraints(ensureArray(card.deckConstraints), errors);
  validateFilename(card, filename, warnings);

  // Warnings are informational only — don't fail validation
  // But print them alongside the card validation for visibility
  if (warnings.length > 0) {
    // Store warnings contextually (only show if there are no errors)
    errors._warnings = warnings;
  }

  return errors;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const validateSchema = await loadSchemaValidator();
  const cardFiles = await findCardFiles();
  const allCards = [];
  const failures = [];

  for (const cardFile of cardFiles) {
    const relativePath = path.relative(projectRoot, cardFile);
    const filename = path.basename(cardFile);
    const { card, errors: loadErrors } = await loadCard(cardFile);

    if (!card) {
      failures.push({ relativePath, errors: loadErrors });
      continue;
    }

    const errors = validateCard(card, filename);
    if (!validateSchema(normalizeCardForSchema(card))) {
      for (const error of validateSchema.errors || []) {
        errors.push(`schema ${error.instancePath || "card"}: ${error.message}`);
      }
    }
    allCards.push({ filename, card, relativePath });

    if (errors.length > 0) {
      failures.push({ relativePath, errors });
    }
  }

  // Cross-reference validation
  const errorsByFile = new Map();
  for (const failure of failures) {
    errorsByFile.set(failure.relativePath, failure.errors);
  }
  validateCrossReferences(allCards, errorsByFile);

  for (const [relativePath, errors] of errorsByFile) {
    if (errors.length > 0 && !failures.some((failure) => failure.relativePath === relativePath)) {
      failures.push({ relativePath, errors });
    }
  }

  if (failures.length > 0) {
    console.error(`\n${colors.red}Card validation FAILED for ${failures.length} file(s):${colors.reset}\n`);

    for (const failure of failures) {
      console.error(`${colors.cyan}${failure.relativePath}${colors.reset}`);
      failure.errors.forEach((error) => console.error(`  ${colors.red}✗${colors.reset} ${error}`));
      console.error();
    }

    process.exitCode = 1;
    return;
  }

  console.log(`${colors.green}✓ Validated ${cardFiles.length} card file(s) successfully.${colors.reset}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  main().catch((error) => {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exitCode = 1;
  });
}
