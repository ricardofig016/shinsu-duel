import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import { collectCardFiles } from "./lib/collect-card-files.js";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(currentFile);
const cardsDirectory = path.join(scriptsDirectory, "..", "data", "cards");

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
  npm run lookup <term>                 Search across all fields
  npm run lookup <field>=<value>        Search a specific field
  npm run lookup <query>,<query>        Intersection (AND) of multiple queries
  npm run lookup /dist <term>           Show type/HP/cost distribution for results
  npm run lookup /help                  Show this help

${colors.Yellow}OPTIONS${colors.Reset}
  /dist           Print a simple HP and cost distribution chart for the results.
  /help           Show this message.

${colors.Yellow}MULTI-FILTER (comma delimiter)${colors.Reset}
  Separate queries with "," for intersection (AND) logic.
  A card must match ALL queries to appear in the results.
  npm run lookup positions=fisherman,cost=3
  npm run lookup positions=fisherman,cost=3,passives=round end:
  npm run lookup positions=fisherman,cost=3,frontline

${colors.Yellow}GLOBAL SEARCH (no "=")${colors.Reset}
  Case-insensitive substring search across ALL fields of every card.
  Basically a Ctrl+F over the entire card collection.

${colors.Yellow}FIELD=VALUE SEARCH${colors.Reset}
  name=         Fuzzy — case-insensitive substring, ignoring spaces & special characters
  type=         Exact — unit, skill, equipment
  kind=         Exact — standard, shinheuh, landmark, conduit
  line=         Exact — frontline, backline
  cost=         Range — number or "min-max" inclusive
  hp=           Range — number or "min-max" inclusive
  rank=         Fuzzy — case-insensitive substring
  positions=    Fuzzy — single position substring
  traits=       Fuzzy — trait name (ignores trailing number)
  attributes=   Fuzzy — attribute substring
  affiliations= Fuzzy — affiliation substring
  passives=     Substring — case-insensitive text search
  abilities=    Substring — case-insensitive text search
  effects=      Substring — case-insensitive text search
  requirements= Substring — case-insensitive text search
  evolve=       Substring — case-insensitive text search
  ignition=     Substring — case-insensitive text search

${colors.Yellow}WILDCARD${colors.Reset}
  field=*       Matches any card that has a non-null, non-empty value for that field.
`)
}

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

async function findCardFiles() {
  return collectCardFiles(cardsDirectory);
}

async function loadCard(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return yaml.load(raw);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(rawArgs) {
  const flags = [];
  const queryArgs = [];
  let dist = false;
  let help = false;

  for (const a of rawArgs) {
    if (a === "/dist") {
      dist = true;
      continue;
    }
    if (a === "/help") {
      help = true;
      continue;
    }
    queryArgs.push(a);
  }

  // Join all non-flag args with a single space, then split on commas for AND queries.
  // This means "npm run lookup living ignition weapon" becomes one global query for
  // "living ignition weapon", while commas are the documented AND delimiter.
  const joined = queryArgs.join(" ");
  const andParts = joined.split(",");

  const parsedQueries = [];
  for (const part of andParts) {
    const trimmed = part.trim();
    if (trimmed.length > 0) {
      parsedQueries.push(trimmed);
    }
  }

  return {
    queries: parsedQueries.map((q) => {
      const eq = q.indexOf("=");
      if (eq === -1) return { field: null, value: q.toLowerCase() };
      return { field: q.slice(0, eq).toLowerCase(), value: q.slice(eq + 1) };
    }),
    dist,
    help,
  };
}

// ---------------------------------------------------------------------------
// Matching primitives
// ---------------------------------------------------------------------------

function substringMatch(actual, expected) {
  return String(actual).toLowerCase().includes(String(expected).toLowerCase());
}

function exactMatch(actual, expected) {
  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

function fuzzyNameMatch(actual, expected) {
  const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return normalize(actual).includes(normalize(expected));
}

function rangeMatch(actual, expected) {
  const rangeMatch = String(expected).match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return Number(actual) >= min && Number(actual) <= max;
  }
  return false;
}

function asList(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw === null || raw === undefined) return [];
  return [raw];
}

// Extract matchable/display text from a DSL entry. Abilities, effects, and
// passives are structured objects whose player-facing text lives in `raw`;
// other fields (positions, traits, requirements) are plain strings.
function dslEntryText(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    return typeof entry.raw === "string" ? entry.raw : JSON.stringify(entry);
  }
  return String(entry);
}

// ---------------------------------------------------------------------------
// Per-field matching
// ---------------------------------------------------------------------------

function fieldMatches(card, fieldName, lookupValue) {
  const cardValue = card[fieldName];

  if (fieldName === "type") {
    return exactMatch(cardValue, lookupValue);
  }

  if (fieldName === "name") {
    if (typeof cardValue === "string") {
      return fuzzyNameMatch(cardValue, lookupValue);
    }
    return false;
  }

  if (fieldName === "abilities" || fieldName === "effects" || fieldName === "passives" || fieldName === "requirements") {
    if (typeof cardValue === "string") {
      return substringMatch(cardValue, lookupValue);
    }
    if (Array.isArray(cardValue)) {
      return cardValue.some((entry) => substringMatch(dslEntryText(entry), lookupValue));
    }
    return false;
  }

  if (fieldName === "cost" || fieldName === "hp") {
    return rangeMatch(cardValue, lookupValue) || exactMatch(cardValue, lookupValue);
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
      const values = asList(raw).filter((v) => substringMatch(dslEntryText(v), lookupTerm));
      if (values.length > 0) {
        matches.push({ field, values: values.map(dslEntryText) });
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

  // Wildcard: match any non-null, non-undefined, non-empty value
  if (lookupValue === "*") {
    if (Array.isArray(raw)) {
      const values = asList(raw);
      if (values.length > 0) {
        return [{ field, values: values.map(dslEntryText) }];
      }
      return [];
    }
    return [{ field, values: [String(raw)] }];
  }

  if (Array.isArray(raw)) {
    const matchedElements = asList(raw).filter((v) => substringMatch(dslEntryText(v), lookupValue));
    if (matchedElements.length > 0) {
      return [{ field, values: matchedElements.map(dslEntryText) }];
    }
    return [];
  }

  // String/number/boolean — direct match
  if (fieldMatches(card, field, lookupValue)) {
    return [{ field, values: [String(raw)] }];
  }

  return [];
}

/** Print a simple horizontal bar-chart of type, HP, cost, rank, positions, traits, attributes and affiliations distribution. */
function showDistribution(matches) {
  const typeMap = new Map();
  const hpMap = new Map();
  const costMap = new Map();
  const rankMap = new Map();
  const posMap = new Map();
  const traitsMap = new Map();
  const attrsMap = new Map();
  const affilsMap = new Map();

  function countArray(map, values, normalize) {
    if (Array.isArray(values)) {
      for (const v of values) {
        if (typeof v === "string") {
          const key = normalize ? normalize(v) : v;
          map.set(key, (map.get(key) || 0) + 1);
        }
      }
    }
  }

  for (const m of matches) {
    const type = m.type;
    const hp = m.hp;
    const cost = m.cost;
    const rank = m.rank;
    const positions = m.positions;
    if (type !== undefined && type !== null) {
      typeMap.set(type, (typeMap.get(type) || 0) + 1);
    }
    if (hp !== undefined && hp !== null) {
      hpMap.set(hp, (hpMap.get(hp) || 0) + 1);
    }
    if (cost !== undefined && cost !== null) {
      costMap.set(cost, (costMap.get(cost) || 0) + 1);
    }
    if (rank !== undefined && rank !== null) {
      rankMap.set(rank, (rankMap.get(rank) || 0) + 1);
    }
    countArray(posMap, positions);
    countArray(traitsMap, m.traits, (v) => v.replace(/\s+\d+$/, ""));
    countArray(attrsMap, m.attributes);
    countArray(affilsMap, m.affiliations);
  }

  const barWidth = 30;

  const draw = (label, map) => {
    if (map.size === 0) {
      console.log(`  ${colors.Dim}(none)${colors.Reset}`);
      return;
    }
    const sorted = [...map.entries()].sort((a, b) => {
      const aNum = typeof a[0] === "number";
      const bNum = typeof b[0] === "number";
      if (aNum && bNum) return a[0] - b[0];
      if (aNum !== bNum) return aNum ? -1 : 1;
      return String(a[0]).localeCompare(String(b[0]));
    });
    const maxLabelLen = Math.max(...sorted.map(([v]) => String(v).length));
    const mapMax = Math.max(...sorted.map(([, count]) => count), 1);
    for (const [val, count] of sorted) {
      const filled = Math.round((count / mapMax) * barWidth);
      const bar = "█".repeat(filled) + "░".repeat(barWidth - filled);
      console.log(
        `  ${String(val).padStart(maxLabelLen)} ${bar} ${colors.Yellow}${count}${colors.Reset}`,
      );
    }
  };

  console.log(`\n${colors.Cyan}── Type distribution ──${colors.Reset}`);
  draw("Type", typeMap);
  console.log(`\n${colors.Cyan}── HP distribution ──${colors.Reset}`);
  draw("HP", hpMap);
  console.log(`\n${colors.Cyan}── Cost distribution ──${colors.Reset}`);
  draw("Cost", costMap);
  console.log(`\n${colors.Cyan}── Rank distribution ──${colors.Reset}`);
  draw("Rank", rankMap);
  console.log(`\n${colors.Cyan}── Positions distribution ──${colors.Reset}`);
  draw("Positions", posMap);
  console.log(`\n${colors.Cyan}── Traits distribution ──${colors.Reset}`);
  draw("Traits", traitsMap);
  console.log(`\n${colors.Cyan}── Attributes distribution ──${colors.Reset}`);
  draw("Attributes", attrsMap);
  console.log(`\n${colors.Cyan}── Affiliations distribution ──${colors.Reset}`);
  draw("Affiliations", affilsMap);
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

  const { queries, dist } = parsed;

  const cardFiles = await findCardFiles();
  const matches = [];

  for (const cardFile of cardFiles) {
    const card = await loadCard(cardFile);
    if (card === null || typeof card !== "object" || Array.isArray(card)) continue;

    // Intersection: card must match EVERY query
    const allQueryMatches = [];
    let matchesAll = true;

    for (const query of queries) {
      // Empty query matches everything
      if (query.value === "") continue;

      const cardMatches =
        query.field === null
          ? legacyGetMatches(card, query.value)
          : fieldValueGetMatches(card, query.field, query.value);

      if (cardMatches.length === 0) {
        matchesAll = false;
        break;
      }
      allQueryMatches.push(...cardMatches);
    }

    if (!matchesAll) continue;

    matches.push({
      name: typeof card.name === "string" ? card.name : path.basename(cardFile),
      type: card.type,
      hp: card.hp,
      cost: card.cost,
      rank: card.rank,
      positions: card.positions,
      traits: card.traits,
      attributes: card.attributes,
      affiliations: card.affiliations,
      relativePath: path.relative(process.cwd(), cardFile),
      matches: allQueryMatches,
    });
  }

  for (const match of matches) {
    const matchedFields = match.matches
      .map(({ field: f, values: vs }) => `${f}=${vs.join(", ")}`)
      .join(", ");

    console.log(
      `${colors.Cyan}- ${match.name}${colors.Reset} ${colors.Yellow}(${matchedFields})${colors.Reset} ${colors.Dim}(${match.relativePath})${colors.Reset}`,
    );
  }

  const modeLabel = queries
    .map((q) => (q.field === null ? `"${q.value}"` : `${q.field}="${q.value}"`))
    .join(", ");
  console.log(`${colors.Green}${matches.length} card(s) found for ${modeLabel}.${colors.Reset}`);

  if (dist && matches.length > 0) {
    showDistribution(matches);
  }
}

// Only run main() when invoked directly (not imported by tests).
const isMain = process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith(path.basename(fileURLToPath(import.meta.url))));

if (isMain) {
  main().catch((error) => {
    console.error(`${colors.Red}${error}${colors.Reset}`);
    process.exitCode = 1;
  });
}

export { parseArgs, legacyGetMatches, fieldValueGetMatches, findCardFiles, loadCard, fieldMatches, showDistribution };
