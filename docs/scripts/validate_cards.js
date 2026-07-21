import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(currentFile);
const cardsDirectory = path.join(scriptsDirectory, "../cards");

const rankCostRanges = {
  regular: [0, 5],
  ranker: [3, 7],
  "high ranker": [5, 10],
};

const allowedTypes = new Set(["unit", "skill", "equipment"]);
const requiredUnitKeys = [
  "type",
  "name",
  "cost",
  "hp",
  "rank",
  "positions",
  "passives",
  "abilities",
  "evolve",
  "traits",
  "attributes",
  "affiliations",
];
const requiredSkillKeys = ["type", "name", "cost", "requirements", "effects"];
const requiredEquipmentKeys = ["type", "name", "cost", "requirements", "effects"];

const rulesDomain = {
  positions: [
    "fisherman",
    "light bearer",
    "scout",
    "spear bearer",
    "wave controller",
    "frontline shinheuh",
    "backline shinheuh",
    "landmark",
  ],
  mainPositions: ["fisherman", "light bearer", "scout", "spear bearer", "wave controller"],
  specialPositions: ["frontline shinheuh", "backline shinheuh", "landmark"],
  traits: [
    "barrier",
    "bloodthirsty",
    "creator",
    "dealer",
    "immune",
    "last one standing",
    "lethal",
    "pierce",
    "reflect",
    "regenerate",
    "resilient",
    "ruthless",
    "sharpshooter",
    "strong",
    "taunt",
  ],
  attributes: ["anima", "silver dwarf", "red witch", "hwayeomsa", "irregular", "jeonsulsa", "living ignition weapon"],
  affiliations: [
    "team aka",
    "team baam",
    "team bero",
    "team chang",
    "team fug",
    "team khel hellam",
    "team novick",
    "team rachel",
    "team sachi",
    "team sweet and sour",
    "khun's team",
    "team ship",
    "fug",
    "hidden grove",
    "karaka's servants",
    "revolution",
    "wolhaiksong",
    "zahard's army",
    "zahard's princesses",
    "great warriors",
    "shining ones",
    "arie family",
    "khun family",
    "ha family",
    "tu perie family",
    "eurasia family",
    "po bidau family",
    "yeon family",
    "ari family",
    "lo po bia family",
    "hendo lok family",
    "blitz family",
    "grand family",
    "edrok family",
    "mule family",
    "nissam family",
    "canines",
    "data humans",
    "prince of the redlight district",
  ],
};

const validators = {
  unit: validateUnit,
  skill: validateSkill,
  equipment: validateEquipment,
};

const allowedPositions = new Set(rulesDomain.positions);
const allowedMainPositions = new Set(rulesDomain.mainPositions);
const specialPositions = new Set(rulesDomain.specialPositions);
const allowedTraits = new Set(rulesDomain.traits);
const allowedAttributes = new Set(rulesDomain.attributes);
const allowedAffiliations = new Set(rulesDomain.affiliations);

function addError(errors, pathName, message) {
  errors.push(`${pathName}: ${message}`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(card, key, errors) {
  if (typeof card[key] !== "string" || card[key].trim() === "") {
    addError(errors, key, "must be a non-empty string");
  }
}

function requireInteger(card, key, errors, { min = 0 } = {}) {
  if (!Number.isInteger(card[key])) {
    addError(errors, key, "must be an integer");
    return;
  }

  if (card[key] < min) {
    addError(errors, key, `must be at least ${min}`);
  }
}

function requireStringListValue(card, key, errors) {
  if (card[key] === null) return [];

  if (!Array.isArray(card[key])) {
    addError(errors, key, "must be a list");
    return [];
  }

  card[key].forEach((entry, index) => {
    if (typeof entry !== "string" || entry.trim() === "") {
      addError(errors, `${key}[${index}]`, "must be a non-empty string");
    }
  });

  return card[key].filter((entry) => typeof entry === "string" && entry.trim() !== "");
}

function requireStringList(card, key, errors) {
  const values = requireStringListValue(card, key, errors);

  if (values.length === 0) {
    addError(errors, key, "must contain at least one value");
  }

  return values;
}

function validateExactKeys(card, requiredKeys, errors) {
  const actualKeys = Object.keys(card);

  if (actualKeys.length !== requiredKeys.length || actualKeys.some((key, index) => key !== requiredKeys[index])) {
    addError(errors, "keys", `must appear exactly in this order: ${requiredKeys.join(", ")}`);
  }
}

function validateKnownValues(values, key, allowed, errors) {
  const seen = new Set();

  values.forEach((value, index) => {
    if (!allowed.has(value)) {
      addError(errors, `${key}[${index}]`, `must exactly match one of: ${[...allowed].join(", ")}`);
      return;
    }

    if (seen.has(value)) {
      addError(errors, `${key}[${index}]`, `duplicates "${value}"`);
    }

    seen.add(value);
  });

  return seen;
}

function validateTraits(values, errors) {
  const seen = new Set();

  values.forEach((value, index) => {
    const match = /^(.+?)(?:\s+(\d+))?$/.exec(String(value));
    const traitName = match[1];
    const traitNumber = match[2];

    if (!allowedTraits.has(traitName)) {
      addError(errors, `traits[${index}]`, `must exactly match one of: ${[...allowedTraits].join(", ")}`);
      return;
    }

    if (traitNumber !== undefined && parseInt(traitNumber, 10) < 1) {
      addError(errors, `traits[${index}]`, `numeric value must be a positive integer`);
    }

    if (seen.has(traitName)) {
      addError(errors, `traits[${index}]`, `duplicates "${traitName}"`);
    }

    seen.add(traitName);
  });
}

function validateRankAndCost(card, errors, { requiresNullRank }) {
  const rank = card.rank;

  if (requiresNullRank) {
    if (rank !== null) {
      addError(errors, "rank", "must be null for shinheuh and landmark units");
    }

    return;
  }

  if (rank === null) {
    addError(errors, "rank", "must not be null unless the unit is a shinheuh or landmark");
    return;
  }

  if (!rankCostRanges[rank]) {
    addError(errors, "rank", `must be one of ${Object.keys(rankCostRanges).join(", ")}`);
    return;
  }

  if (!Number.isInteger(card.cost)) return;

  const [minCost, maxCost] = rankCostRanges[rank];
  if (card.cost < minCost || card.cost > maxCost) {
    addError(errors, "cost", `${rank} units must cost between ${minCost} and ${maxCost}`);
  }
}

function validateUnit(card) {
  const errors = [];
  validateExactKeys(card, requiredUnitKeys, errors);

  requireString(card, "name", errors);
  requireInteger(card, "hp", errors, { min: 1 });
  requireInteger(card, "cost", errors, { min: 0 });

  const positionCodes = validateKnownValues(requireStringList(card, "positions", errors), "positions", allowedPositions, errors);
  validateTraits(requireStringListValue(card, "traits", errors), errors);
  validateKnownValues(requireStringListValue(card, "attributes", errors), "attributes", allowedAttributes, errors);
  validateKnownValues(requireStringListValue(card, "affiliations", errors), "affiliations", allowedAffiliations, errors);
  const abilityValues = requireStringListValue(card, "abilities", errors);
  requireStringListValue(card, "evolve", errors);
  requireStringListValue(card, "passives", errors);
  const attributeValues = requireStringListValue(card, "attributes", errors);
  const specialPositionCodes = [...positionCodes].filter((positionCode) => specialPositions.has(positionCode));
  const hasSpecialPosition = specialPositionCodes.length > 0;
  validateRankAndCost(card, errors, { requiresNullRank: hasSpecialPosition });

  if (hasSpecialPosition && positionCodes.size > 1) {
    addError(errors, "positions", "shinheuh and landmark units cannot have any other position");
  }

  if (positionCodes.has("landmark")) {
    if (card.abilities !== null) {
      addError(errors, "abilities", "landmark units must have null abilities");
    }

    if (card.attributes !== null) {
      addError(errors, "attributes", "landmark units must have null attributes");
    }
  }

  for (const positionCode of positionCodes) {
    if (specialPositions.has(positionCode)) continue;
    if (!allowedMainPositions.has(positionCode)) {
      addError(errors, "positions", `${positionCode} is not a unit position named in RULES.md`);
    }
  }

  return errors;
}

function validateSkill(card) {
  const errors = [];
  validateExactKeys(card, requiredSkillKeys, errors);

  requireString(card, "name", errors);
  requireInteger(card, "cost", errors, { min: 0 });
  requireStringListValue(card, "requirements", errors);
  requireStringListValue(card, "requirements", errors);
  requireStringListValue(card, "effects", errors);

  return errors;
}

function validateEquipment(card) {
  const errors = [];
  validateExactKeys(card, requiredEquipmentKeys, errors);

  requireString(card, "name", errors);
  requireInteger(card, "cost", errors, { min: 0 });
  requireStringListValue(card, "requirements", errors);
  requireStringListValue(card, "effects", errors);

  return errors;
}

async function loadCard(filePath) {
  const source = await fs.readFile(filePath, "utf8");

  try {
    const card = yaml.load(source);

    if (!isPlainObject(card)) {
      return { card: null, errors: ["card file must contain a YAML object"] };
    }

    return { card, errors: [] };
  } catch (error) {
    return { card: null, errors: [`invalid YAML: ${error.message}`] };
  }
}

async function findCardFiles() {
  const entries = await fs.readdir(cardsDirectory, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(cardsDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function expectedFilename(name) {
  return (
    name
      .toLowerCase()
      .replace(/[\s\-]+/g, "_")
      .replace(/[^a-z0-9_]/g, "") + ".yml"
  );
}

function validateFilename(card, filename, errors) {
  if (typeof card.name !== "string" || card.name.trim() === "") return;

  const expected = expectedFilename(card.name);
  if (filename !== expected) {
    addError(errors, "filename", `"${filename}" does not match name field "${card.name}"`);
  }
}

function validateCard(card, filename) {
  const errors = [];

  if (typeof card.type !== "string" || card.type.trim() === "") {
    addError(errors, "type", "must be one of unit, skill, equipment");
    return errors;
  }

  const type = card.type;
  if (!allowedTypes.has(type)) {
    addError(errors, "type", "must be one of unit, skill, equipment");
    return errors;
  }

  const validator = validators[type];
  if (!validator) {
    addError(errors, "type", `${type} validation is not implemented yet`);
    return errors;
  }

  const typeErrors = validator({ ...card, type });
  validateFilename(card, filename, typeErrors);
  return typeErrors;
}

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

async function main() {
  const cardFiles = await findCardFiles();
  const failures = [];

  for (const cardFile of cardFiles) {
    const relativePath = path.relative(process.cwd(), cardFile);
    const { card, errors: loadErrors } = await loadCard(cardFile);
    const filename = path.basename(cardFile);
    const errors = card ? validateCard(card, filename) : loadErrors;

    if (errors.length > 0) {
      failures.push({ relativePath, errors });
    }
  }

  if (failures.length > 0) {
    console.error(`${colors.red}Card validation failed for ${failures.length} file(s):${colors.reset}`);

    for (const failure of failures) {
      console.error(`${colors.cyan}\n${failure.relativePath}${colors.reset}`);
      failure.errors.forEach((error) => console.error(`${colors.red}  - ${error}${colors.reset}`));
    }

    process.exitCode = 1;
    return;
  }

  console.log(`${colors.green}Validated ${cardFiles.length} card file(s).${colors.reset}`);
}

main().catch((error) => {
  console.error(`${colors.red}${error}${colors.reset}`);
  process.exitCode = 1;
});