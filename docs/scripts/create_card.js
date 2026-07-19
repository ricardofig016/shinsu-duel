import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const scriptsDirectory = path.dirname(currentFile);
const cardsDirectory = path.join(scriptsDirectory, "../cards");

const allowedTypes = new Set(["unit", "consumable", "equipment"]);

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
  consumable: `type: consumable
name: 
cost: 
abilities:
`,
  equipment: `type: equipment
name: 
cost: 
requirements:
abilities:
`,
};

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

function toDisplayName(snakeName) {
  return snakeName
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function main() {
  const type = process.argv[2];
  const nameArg = process.argv[3];

  if (!type || !nameArg) {
    console.error(`${colors.red}Usage: npm run create:card <type> <name>${colors.reset}`);
    console.error(`${colors.red}Types: ${[...allowedTypes].join(", ")}${colors.reset}`);
    console.error(`${colors.red}Example: npm run create:card unit khun_ran${colors.reset}`);
    process.exitCode = 1;
    return;
  }

  if (!allowedTypes.has(type)) {
    console.error(`${colors.red}Unknown type "${type}". Must be one of: ${[...allowedTypes].join(", ")}${colors.reset}`);
    process.exitCode = 1;
    return;
  }

  const filename = `${nameArg}.yml`;
  const filePath = path.join(cardsDirectory, filename);

  try {
    await fs.access(filePath);
    console.error(`${colors.red}File already exists: docs/cards/${filename}${colors.reset}`);
    process.exitCode = 1;
    return;
  } catch {
    // file does not exist, proceed
  }

  const displayName = toDisplayName(nameArg);
  const content = templates[type].replace(/^(name: )$/m, `$1${displayName}`);
  await fs.writeFile(filePath, content, "utf8");
  console.log(`${colors.green}Created ${colors.cyan}docs/cards/${filename}${colors.reset}`);
}

main().catch((error) => {
  console.error(`${colors.red}${error}${colors.reset}`);
  process.exitCode = 1;
});
