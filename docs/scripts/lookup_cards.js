import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(currentFile);
const cardsDirectory = path.join(scriptsDirectory, "../cards");

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

const lookupFields = ["type", "rank", "positions", "traits", "attributes", "affiliations"];

function getLookupTerm() {
  return process.argv.slice(2).join(" ").trim().toLowerCase();
}

function asList(value) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string");
}

function matchesLookupValue(value, lookupTerm) {
  if (typeof value !== "string") return false;

  const normalizedValue = value.toLowerCase();
  if (lookupTerm === "shinheuh") {
    return normalizedValue === "frontline shinheuh" || normalizedValue === "backline shinheuh";
  }

  return normalizedValue === lookupTerm;
}

function getMatches(card, lookupTerm) {
  const matches = [];

  for (const field of lookupFields) {
    if (Array.isArray(card[field])) {
      const values = asList(card[field]).filter((value) => matchesLookupValue(value, lookupTerm));
      if (values.length > 0) {
        matches.push({ field, values });
      }

      continue;
    }

    if (matchesLookupValue(card[field], lookupTerm)) {
      matches.push({ field, values: [card[field]] });
    }
  }

  return matches;
}

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

async function main() {
  const lookupTerm = getLookupTerm();

  if (lookupTerm === "") {
    console.error(`${colors.red}Usage: npm run lookup <type|rank|position|trait|attribute|affiliation>${colors.reset}`);
    process.exitCode = 1;
    return;
  }

  const cardFiles = await findCardFiles();
  const matches = [];

  for (const cardFile of cardFiles) {
    const card = await loadCard(cardFile);
    if (card === null || typeof card !== "object" || Array.isArray(card)) continue;

    const cardMatches = getMatches(card, lookupTerm);
    if (cardMatches.length === 0) continue;

    matches.push({
      name: typeof card.name === "string" ? card.name : path.basename(cardFile),
      relativePath: path.relative(process.cwd(), cardFile),
      matches: cardMatches,
    });
  }

  for (const match of matches) {
    const matchedFields = match.matches
      .map(({ field, values }) => `${field}=${values.join(", ")}`)
      .join("; ");

    console.log(`${colors.cyan}- ${match.name}${colors.reset} ${colors.yellow}(${matchedFields})${colors.reset} (${match.relativePath})`);
  }

  console.log(`${colors.green}${matches.length} card(s) found for "${lookupTerm}".${colors.reset}`);
}

main().catch((error) => {
  console.error(`${colors.red}${error}${colors.reset}`);
  process.exitCode = 1;
});
