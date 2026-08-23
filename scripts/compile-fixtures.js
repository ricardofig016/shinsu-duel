import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

import { collectCardFiles } from "./lib/collect-card-files.js";
import {
  compileCard,
  cleanCompiled,
  resolveEvolveInto,
  resolveEvolvedFrom,
  resolveIgniteInto,
  resolveIgnitedFrom,
} from "./card-compile.js";

/**
 * Compiles the test-owned fixture catalog.
 *
 * Fixtures are authored as YAML in `server/game/tests/fixtures/yaml/` using
 * the **same source shape as `data/cards`** (display names for positions/
 * attributes/affiliations, string traits, raw `evolve`/`ignition` strings).
 * This script normalizes and schema-validates them through the real compiler,
 * then emits the compiled artifact `fixtures/cards.json` that `cards.js`
 * imports. A fixture author never hand-writes the compiled shape.
 *
 * Two deliberate deviations from `card-compile.js`:
 *   - `cardId` is authored explicitly on each fixture (named 1000+, fillers
 *     1..40) so the numeric-id ordering that `createLegalDeck` relies on is
 *     preserved instead of the compiler's name-sorted assignment.
 *   - `card-validate.js` domain rules (rank→cost ranges, null-rank positions)
 *     do not apply to fixtures; they are small, load-bearing mirrors that
 *     deliberately exercise edge shapes. Schema validation still runs.
 */

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const fixturesYamlDir = path.join(projectRoot, "server", "game", "tests", "fixtures", "yaml");
const outputPath = path.join(projectRoot, "server", "game", "tests", "fixtures", "cards.json");
const compiledSchemaPath = path.join(projectRoot, "schemas", "compiled-cards.schema.json");

// ── Generic filler units (deck padding; ≥30 needed for legal decks) ──────
// Fillers use the LOWEST ids because JS integer-like object keys sort
// numerically and `createLegalDeck` slices the first eligible cards. Keeping
// fillers first means deck-based assertions never depend on a named fixture.
const FILLER_START = 1;
const FILLER_COUNT = 40;

function buildFillers() {
  const fillers = [];
  for (let i = 0; i < FILLER_COUNT; i++) {
    fillers.push({
      cardId: FILLER_START + i,
      type: "unit",
      name: `Test Filler ${i + 1}`,
      cost: 1,
      hp: 3,
      rank: "regular",
      positions: ["fisherman"],
      traits: [],
      attributes: [],
      affiliations: [],
      abilities: [],
      passives: [],
      deckConstraints: [],
    });
  }
  return fillers;
}

export async function compileFixtures() {
  // 1. Collect named fixtures (YAML source) + generated fillers.
  const yamlFiles = await collectCardFiles(fixturesYamlDir);
  const rawCards = buildFillers();

  for (const file of yamlFiles) {
    const raw = await fs.readFile(file, "utf-8");
    const card = yaml.load(raw);
    if (!card || !card.type) {
      throw new Error(`${path.relative(projectRoot, file)}: no valid card data`);
    }
    if (!Number.isInteger(card.cardId)) {
      throw new Error(`${path.relative(projectRoot, file)}: missing integer "cardId"`);
    }
    rawCards.push(card);
  }

  // 2. Explicit cardId uniqueness (the compiler assigns ids by name sort).
  const seen = new Set();
  for (const raw of rawCards) {
    if (seen.has(raw.cardId)) throw new Error(`duplicate fixture cardId ${raw.cardId}`);
    seen.add(raw.cardId);
  }

  // 3. Compile each card through the real compiler.
  const compiled = rawCards.map((raw) => {
    const card = compileCard(raw, rawCards.map((r) => ({ name: r.name, cardId: r.cardId })));
    card.cardId = raw.cardId;
    return card;
  });

  // 4. Resolve evolution/ignition cross-references.
  const allWithIds = compiled.map((c) => ({ name: c.name, cardId: c.cardId }));
  for (const card of compiled) {
    const raw = rawCards.find((r) => r.name === card.name);
    if (!raw) throw new Error(`internal: raw card not found for "${card.name}"`);

    if (card.type === "unit" && raw.evolve && raw.evolve.length > 0) {
      card.evolveInto = resolveEvolveInto({ ...raw, name: card.name }, allWithIds);
    }
    card.evolvedFrom = resolveEvolvedFrom({ ...raw, name: card.name, type: card.type }, allWithIds);

    if (card.type === "equipment" && raw.ignition && raw.ignition.length > 0) {
      card.igniteInto = resolveIgniteInto({ ...raw, name: card.name }, allWithIds);
    }
    card.ignitedFrom = resolveIgnitedFrom({ ...raw, name: card.name, type: card.type }, allWithIds);
  }

  // 5. Clean up temporary/empty fields to the sparse compiled contract.
  const finalCards = compiled.map(cleanCompiled);

  // 6. Validate against the compiled schema.
  const output = {};
  for (const card of finalCards) output[String(card.cardId)] = card;

  const compiledSchema = JSON.parse(await fs.readFile(compiledSchemaPath, "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validate = ajv.compile(compiledSchema);
  if (!validate(output)) {
    const details = (validate.errors || [])
      .map((error) => `${error.instancePath || "output"}: ${error.message}`)
      .join("\n  ");
    throw new Error(`Compiled fixture data failed ${path.relative(projectRoot, compiledSchemaPath)}:\n  ${details}`);
  }

  // 7. Write the artifact.
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  console.log(`✓ Compiled ${finalCards.length} fixture cards to ${path.relative(projectRoot, outputPath)}`);
  return finalCards;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  compileFixtures().catch((error) => {
    console.error(`Fatal error: ${error.message}`);
    console.error(error.stack);
    process.exitCode = 1;
  });
}
