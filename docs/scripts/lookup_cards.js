import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(currentFile);
const cardsDirectory = path.join(scriptsDirectory, "..", "cards");

const colors = {
  Reset: "\x1b[0m",
  Red: "\x1b[31m",
  Green: "\x1b[32m",
  Cyan: "\x1b[36m",
  Yellow: "\x1b[33m",
  Dim: "\x1b[2m",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function showHelp() {
  console.log(`
${colors.Cyan}lookup${colors.Reset} — Search cards by field values

${colors.Yellow}USAGE${colors.Reset}
  npm run lookup <term>                 Search predefined fields
  npm run lookup <field>=<value>        Search a specific field
  npm run lookup --help                 Show this help

${colors.Yellow}GLOBAL SEARCH (no "=")${colors.Reset}
  Case-insensitive substring search across ALL fields of every card.
  Think of it as a glorified Ctrl+F over the entire card collection.

${colors.Yellow}FIELD=VALUE SEARCH${colors.Reset}
  name=         Fuzzy — case-insensitive substring, ignoring spaces & special chars
  abilities=    Substring search within each ability text (case-insensitive)
  effects=      Substring search within each effect text   (case-insensitive)
  passives=     Substring search within each passive text  (case-insensitive)
  cost= / hp=   Exact match (compared as strings)
  Other fields  Exact case-insensitive match (scalar) or element match (array)

${colors.Yellow}EXAMPLES${colors.Reset}
  npm run lookup tank
  npm run lookup shinheuh
  npm run lookup name=Thorn
  npm run lookup name=Thorn Fragment
  npm run lookup cost=2
  npm run lookup hp=6
  npm run lookup abilities=spend 2:
  npm run lookup effects=deal 6
`);
}

/** Lowercase, strip everything except a-z0-9. */
function fuzzyNormalize(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Fuzzy name match: both sides are fuzzy-normalised, then substring check. */
function fuzzyNameMatch(cardName, lookupValue) {
  return fuzzyNormalize(cardName).includes(fuzzyNormalize(lookupValue));
}

function substringMatch(text, lookupValue) {
  return text.toLowerCase().includes(lookupValue.toLowerCase());
}

function exactMatch(a, b) {
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function asList(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string");
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

/**
 * Join all positional args with a space, then split on the first '='.
 *
 * Returns { help: true } for --help / -h,
 *         { field: null, value: "…" } for legacy mode (no '='),
 *         { field: "…", value: "…" } for field=value mode.
 */
function parseArgs(rawArgs) {
  const joined = rawArgs.join(" ").trim();

  if (joined === "--help" || joined === "-h") {
    return { help: true };
  }

  const eqIndex = joined.indexOf("=");
  if (eqIndex === -1) {
    return { field: null, value: joined.toLowerCase() };
  }

  const field = joined.slice(0, eqIndex).trim().toLowerCase();
  const value = joined.slice(eqIndex + 1).trim();
  return { field, value };
}

// ---------------------------------------------------------------------------
// Matching logic
// ---------------------------------------------------------------------------

/**
 * Match a single card-field value against a user-supplied lookup value.
 * Chooses the strategy based on the field name.
 */
function fieldValueMatches(fieldName, cardValue, lookupValue) {
  if (cardValue === null || cardValue === undefined) return false;

  if (fieldName === "name") {
    return fuzzyNameMatch(String(cardValue), lookupValue);
  }

  if (fieldName === "abilities" || fieldName === "effects" || fieldName === "passives") {
    if (typeof cardValue === "string") {
      return substringMatch(cardValue, lookupValue);
    }
    return false;
  }

  return exactMatch(cardValue, lookupValue);
}

/**
 * Legacy / global mode: case-insensitive substring search across EVERY field.
 * Scalars and array elements are all checked — glorified Ctrl+F.
 */
function legacyGetMatches(card, lookupTerm) {
  const matches = [];

  for (const field of Object.keys(card)) {
    const raw = card[field];
    if (raw === null || raw === undefined) continue;

    if (Array.isArray(raw)) {
      const values = asList(raw).filter((v) => substringMatch(v, lookupTerm));
      if (values.length > 0) {
        matches.push({ field, values });
      }
    } else if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      if (substringMatch(String(raw), lookupTerm)) {
        matches.push({ field, values: [String(raw)] });
      }
    }
  }

  return matches;
}

/**
 * field=value mode: search a single, user-specified field.
 *
 * - Arrays (abilities, traits, etc.): check each element.
 * - Scalars (cost, hp, name, etc.): check directly.
 */
function fieldValueGetMatches(card, field, lookupValue) {
  const raw = card[field];
  if (raw === null || raw === undefined) return [];

  if (Array.isArray(raw)) {
    const values = asList(raw).filter((v) => fieldValueMatches(field, v, lookupValue));
    if (values.length > 0) {
      return [{ field, values }];
    }
    return [];
  }

  if (fieldValueMatches(field, raw, lookupValue)) {
    return [{ field, values: [String(raw)] }];
  }

  return [];
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

async function findCardFiles() {
  const entries = await fs.readdir(cardsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(cardsDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function loadCard(filePath) {
  const source = await fs.readFile(filePath, "utf8");
  return yaml.load(source);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const parsed = parseArgs(process.argv.slice(2));

  if (parsed.help) {
    showHelp();
    return;
  }

  const { field, value } = parsed;

  if (field === null && value === "") {
    console.error(`${colors.Red}Usage: npm run lookup <field=value|term>${colors.Reset}`);
    console.error(`${colors.Dim}       npm run lookup --help${colors.Reset}`);
    process.exitCode = 1;
    return;
  }

  const cardFiles = await findCardFiles();
  const matches = [];

  for (const cardFile of cardFiles) {
    const card = await loadCard(cardFile);
    if (card === null || typeof card !== "object" || Array.isArray(card)) continue;

    const cardMatches =
      field === null
        ? legacyGetMatches(card, value)
        : fieldValueGetMatches(card, field, value);

    if (cardMatches.length === 0) continue;

    matches.push({
      name: typeof card.name === "string" ? card.name : path.basename(cardFile),
      relativePath: path.relative(process.cwd(), cardFile),
      matches: cardMatches,
    });
  }

  for (const match of matches) {
    const matchedFields = match.matches
      .map(({ field: f, values: vs }) => `${f}=${vs.join(", ")}`)
      .join("; ");

    console.log(
      `${colors.Cyan}- ${match.name}${colors.Reset} ${colors.Yellow}(${matchedFields})${colors.Reset} ${colors.Dim}(${match.relativePath})${colors.Reset}`,
    );
  }

  const modeLabel = field === null ? `"${value}"` : `${field}="${value}"`;
  console.log(`${colors.Green}${matches.length} card(s) found for ${modeLabel}.${colors.Reset}`);
}

main().catch((error) => {
  console.error(`${colors.Red}${error}${colors.Reset}`);
  process.exitCode = 1;
});
