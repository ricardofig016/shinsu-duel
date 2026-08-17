import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import yaml from "js-yaml";

import cardsData from "../../../data/cards.json" with { type: "json" };
import compiledSchema from "../../../../schemas/compiled-cards.schema.json" with { type: "json" };

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../..");
const cardsDirectory = path.join(projectRoot, "data", "cards");

async function collectYamlFiles(rootDir) {
  const results = [];
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
        results.push(fullPath);
      }
    }
  }
  await walk(rootDir);
  return results.sort();
}

describe("card data audit (zero custom/handler invariant)", () => {
  test("checked-in cards.json contains no `custom` types or `handler` fields", () => {
    const serialized = JSON.stringify(cardsData);
    expect(serialized).not.toContain('"custom"');
    expect(serialized).not.toContain('"handler"');
  });

  test("checked-in cards.json validates against the compiled schema", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(compiledSchema);
    const valid = validate(cardsData);
    expect(validate.errors ?? null).toBeNull();
    expect(valid).toBe(true);
  });

  test("all YAML abilities/effects/passives are structured objects (no prose)", async () => {
    const yamlFiles = await collectYamlFiles(cardsDirectory);
    expect(yamlFiles.length).toBe(82);

    for (const file of yamlFiles) {
      const card = yaml.load(await fs.readFile(file, "utf-8"));
      // `requirements` is a string list (not DSL nodes) — excluded here.
      const entries = [
        ...(card.abilities || []),
        ...(card.effects || []),
        ...(card.passives || []),
      ];
      for (const entry of entries) {
        expect(entry).not.toBeNull();
        expect(typeof entry).toBe("object");
      }
    }
  });
});
