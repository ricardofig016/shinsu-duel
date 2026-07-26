import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const cardsDirectory = path.join(projectRoot, "data", "cards");

const allowedTypes = new Set(["unit", "skill", "equipment"]);

const templates = {
  unit: `type: unit
name: 
cost: 
hp: 
rank: 
positions:
passives:
abilities:
evolve:
traits:
attributes:
affiliations:
`,
  skill: `type: skill
name: 
cost: 
requirements:
effects:
`,
  equipment: `type: equipment
name: 
cost: 
requirements:
effects:
ignition:
`,
};

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

function normalizeName(rawName) {
  return rawName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

async function main() {
  const type = process.argv[2];
  const nameArg = process.argv.slice(3).join(" ");

  if (!type || !nameArg) {
    console.error(`${colors.red}Usage: npm run create:card <type> <name>${colors.reset}`);
    console.error(`${colors.red}Types: ${[...allowedTypes].join(", ")}${colors.reset}`);
    console.error(`${colors.red}Example: npm run create:card unit Khun Ran${colors.reset}`);
    process.exitCode = 1;
    return;
  }

  if (!allowedTypes.has(type)) {
    console.error(`${colors.red}Unknown type "${type}". Must be one of: ${[...allowedTypes].join(", ")}${colors.reset}`);
    process.exitCode = 1;
    return;
  }

  const normalizedName = normalizeName(nameArg);
  const filename = `${normalizedName}.yml`;
  const filePath = path.join(cardsDirectory, filename);

  try {
    await fs.access(filePath);
    console.error(`${colors.red}Card file already exists: ${filename}${colors.reset}`);
    process.exitCode = 1;
    return;
  } catch {
    // File does not exist — proceed
  }

  const displayName = nameArg
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  let template = templates[type];

  // For unit cards, pre-fill the name
  if (type === "unit") {
    template = template.replace("name: ", `name: ${displayName}`);
  } else {
    template = template.replace("name: ", `name: ${displayName}`);
  }

  try {
    await fs.mkdir(cardsDirectory, { recursive: true });
    await fs.writeFile(filePath, template, "utf-8");
    console.log(`${colors.green}✓ Created ${colors.cyan}${filename}${colors.green} (${type})${colors.reset}`);
  } catch (err) {
    console.error(`${colors.red}Failed to create file: ${err.message}${colors.reset}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`${colors.red}${error.message}${colors.reset}`);
  process.exitCode = 1;
});
