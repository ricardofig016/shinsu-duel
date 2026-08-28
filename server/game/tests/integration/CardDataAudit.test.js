import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import yaml from "js-yaml";

import cardsData from "../../../data/cards.json" with { type: "json" };
import compiledSchema from "../../../../schemas/compiled-cards.schema.json" with { type: "json" };
import sourceSchema from "../../../../schemas/card.schema.json" with { type: "json" };
import dslCatalog from "../../../../schemas/dsl-catalog.json" with { type: "json" };

import { compileCards } from "../../../../scripts/card-compile.js";
import { normalizeCardForSchema } from "../../../../scripts/card-validate.js";
import { MODIFIER_TYPES } from "../../services/ModifierService.js";
import { RULE_TYPES } from "../../services/GlobalRuleRegistry.js";
import { initEffectResolver } from "../../EffectResolver.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, "../../../..");
const cardsDirectory = path.join(projectRoot, "data", "cards");

// Catalog vocabularies the audit enforces over the shipped data.
const NODE_CATEGORIES = ["structural", "markers", "effects", "modifiers", "rules"];
const NODE_TYPES = new Set(NODE_CATEGORIES.flatMap((category) => dslCatalog[category]));
const TRIGGER_TYPES = new Set(dslCatalog.triggers);
const PREDICATE_TYPES = new Set(dslCatalog.predicates);

const NODE_LISTS = ["abilities", "effects", "passives", "rules"];
const CHILD_NODE_KEYS = ["effect", "ability", "then", "otherwise"];

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

let sourceCardsCache = null;
async function loadSourceCards() {
  if (!sourceCardsCache) {
    sourceCardsCache = [];
    for (const file of await collectYamlFiles(cardsDirectory)) {
      sourceCardsCache.push({ file, card: yaml.load(await fs.readFile(file, "utf-8")) });
    }
  }
  return sourceCardsCache;
}

/**
 * Recursively collect every DSL discriminator used by the compiled cards,
 * keyed type -> locations. Node types come from every object with a string
 * `type` under abilities/effects/passives/rules (including nested
 * sequence/conditional/`effect`/`ability` branches); trigger and predicate
 * types are collected from their dedicated fields.
 */
function collectInventory(cards) {
  const nodeTypes = new Map();
  const triggerTypes = new Map();
  const predicateTypes = new Map();

  const record = (bucket, type, location) => {
    if (!bucket.has(type)) bucket.set(type, []);
    bucket.get(type).push(location);
  };

  const walk = (node, location) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    if (typeof node.type === "string") record(nodeTypes, node.type, location);
    if (node.trigger && typeof node.trigger === "object" && typeof node.trigger.type === "string") {
      record(triggerTypes, node.trigger.type, `${location}.trigger`);
    }
    if (Array.isArray(node.triggers)) {
      node.triggers.forEach((trigger, index) => {
        if (trigger && typeof trigger === "object" && typeof trigger.type === "string") {
          record(triggerTypes, trigger.type, `${location}.triggers[${index}]`);
        }
      });
    }
    if (node.if && typeof node.if === "object" && typeof node.if.type === "string") {
      record(predicateTypes, node.if.type, `${location}.if`);
    }
    for (const key of CHILD_NODE_KEYS) {
      if (node[key]) walk(node[key], `${location}.${key}`);
    }
    if (Array.isArray(node.steps)) {
      node.steps.forEach((step, index) => walk(step, `${location}.steps[${index}]`));
    }
  };

  for (const [key, card] of Object.entries(cards)) {
    for (const listName of NODE_LISTS) {
      (card[listName] || []).forEach((entry, index) =>
        walk(entry, `${key} "${card.name}" ${listName}[${index}]`));
    }
    // Transformation triggers are compiled ASTs hanging off the
    // evolution/ignition cross-references, not passive entries.
    for (const refName of ["evolveInto", "igniteInto"]) {
      const ref = card[refName];
      if (ref && Array.isArray(ref.triggers)) {
        ref.triggers.forEach((trigger, index) => {
          if (trigger && typeof trigger.type === "string") {
            record(triggerTypes, trigger.type, `${key} "${card.name}" ${refName}.triggers[${index}]`);
          }
        });
      }
    }
  }
  return { nodeTypes, triggerTypes, predicateTypes };
}

// Recursive key-sorted copy of the JSON tree. Arrays keep their semantic
// order; object key order is the only thing the comparison ignores, so a
// fresh compile must match the checked-in artifact in every field, ID
// included.
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function formatTypeReport(entries) {
  return entries.map(([type, paths]) => `${type} (e.g. ${paths.slice(0, 3).join("; ")})`);
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
    for (const { card } of await loadSourceCards()) {
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

describe("card data audit (source/artifact identity)", () => {
  test("every source card validates against the source schema", async () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(sourceSchema);
    const failures = [];
    for (const { file, card } of await loadSourceCards()) {
      if (!validate(normalizeCardForSchema(card))) {
        failures.push(`${path.relative(projectRoot, file)}: ${(validate.errors || [])
          .map((error) => `${error.instancePath || "card"} ${error.message}`)
          .join("; ")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  test("a fresh in-memory compile equals the checked-in artifact", async () => {
    const { output } = await compileCards();
    expect(canonicalize(output)).toEqual(canonicalize(cardsData));
  });

  test("card identity is unique and follows the stable name-sorted cardId contract", () => {
    const cards = Object.values(cardsData);
    const names = cards.map((card) => card.name);

    expect(new Set(names).size).toBe(names.length);
    for (const [key, card] of Object.entries(cardsData)) {
      expect(String(card.cardId)).toBe(key);
    }
    // cardId is the card's index in the compiler's name-sorted order.
    const nameSorted = [...cards].sort((a, b) => a.name.localeCompare(b.name));
    const mispositioned = nameSorted
      .map((card, index) => ({ name: card.name, cardId: card.cardId, expectedId: index }))
      .filter((entry) => entry.cardId !== entry.expectedId)
      .map((entry) => `"${entry.name}" has cardId ${entry.cardId}, expected ${entry.expectedId}`);
    expect(mispositioned).toEqual([]);
  });

  test("the artifact contains exactly the source cards (no missing, no orphans)", async () => {
    const sourceCards = await loadSourceCards();
    const sourceNames = sourceCards.map(({ card }) => card?.name).filter(Boolean);
    const artifactNames = Object.values(cardsData).map((card) => card.name);

    expect(sourceNames.length).toBe(artifactNames.length);
    expect(new Set(sourceNames).size).toBe(sourceNames.length);

    const artifactNameSet = new Set(artifactNames);
    const sourceNameSet = new Set(sourceNames);
    expect(sourceNames.filter((name) => !artifactNameSet.has(name))).toEqual([]);
    expect(artifactNames.filter((name) => !sourceNameSet.has(name))).toEqual([]);
  });

  test("evolution and ignition cross-references point at their conventioned counterpart", () => {
    const violations = [];
    for (const card of Object.values(cardsData)) {
      // evolveInto/igniteInto are { triggers, cardId } objects; the
      // back-references (evolvedFrom/ignitedFrom) are plain cardIds.
      if (card.evolveInto != null) {
        const target = cardsData[String(card.evolveInto.cardId)];
        if (target?.name !== `${card.name} - Evolved`) {
          violations.push(`"${card.name}".evolveInto.cardId -> ${card.evolveInto.cardId} ("${target?.name}")`);
        }
        if (!Array.isArray(card.evolveInto.triggers) || card.evolveInto.triggers.length === 0) {
          violations.push(`"${card.name}".evolveInto carries no compiled triggers`);
        }
      }
      if (card.evolvedFrom != null) {
        const base = cardsData[String(card.evolvedFrom)];
        if (base?.name !== card.name.replace(/\s*-\s*evolved\s*/i, "").trim()) {
          violations.push(`"${card.name}".evolvedFrom -> ${card.evolvedFrom} ("${base?.name}")`);
        }
      }
      if (card.igniteInto != null) {
        const target = cardsData[String(card.igniteInto.cardId)];
        if (target?.name !== `${card.name} - Ignited`) {
          violations.push(`"${card.name}".igniteInto.cardId -> ${card.igniteInto.cardId} ("${target?.name}")`);
        }
        if (!Array.isArray(card.igniteInto.triggers) || card.igniteInto.triggers.length === 0) {
          violations.push(`"${card.name}".igniteInto carries no compiled triggers`);
        }
      }
      if (card.ignitedFrom != null) {
        const base = cardsData[String(card.ignitedFrom)];
        if (base?.name !== card.name.replace(/\s*-\s*ignited\s*/i, "").trim()) {
          violations.push(`"${card.name}".ignitedFrom -> ${card.ignitedFrom} ("${base?.name}")`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("card data audit (recursive DSL inventory)", () => {
  test("every compiled node type is cataloged", () => {
    const { nodeTypes } = collectInventory(cardsData);
    const unknown = [...nodeTypes.entries()].filter(([type]) => !NODE_TYPES.has(type));
    expect(formatTypeReport(unknown)).toEqual([]);
  });

  test("every used trigger type is cataloged", () => {
    const { triggerTypes } = collectInventory(cardsData);
    const unknown = [...triggerTypes.entries()].filter(([type]) => !TRIGGER_TYPES.has(type));
    expect(formatTypeReport(unknown)).toEqual([]);
  });

  test("every used predicate type is cataloged", () => {
    const { predicateTypes } = collectInventory(cardsData);
    const unknown = [...predicateTypes.entries()].filter(([type]) => !PREDICATE_TYPES.has(type));
    expect(formatTypeReport(unknown)).toEqual([]);
  });

  test("every top-level DSL entry carries non-empty authored raw text", () => {
    const violations = [];
    for (const card of Object.values(cardsData)) {
      for (const listName of NODE_LISTS) {
        (card[listName] || []).forEach((entry, index) => {
          if (!entry || typeof entry !== "object") {
            violations.push(`"${card.name}" ${listName}[${index}] is not an object`);
            return;
          }
          if (typeof entry.raw !== "string" || entry.raw.trim() === "") {
            violations.push(`"${card.name}" ${listName}[${index}] (${entry.type}) has no non-empty "raw"`);
          }
        });
      }
    }
    expect(violations).toEqual([]);
  });
});

describe("card data audit (runtime ownership coverage)", () => {
  test("every dispatchable effect type is registered in HandlerRegistry", () => {
    const registered = new Set(initEffectResolver().names());
    const { nodeTypes } = collectInventory(cardsData);

    const unowned = dslCatalog.effects
      .filter((type) => !registered.has(type))
      .map((type) => ({
        type,
        usedByShippedCards: nodeTypes.has(type),
        exampleLocations: (nodeTypes.get(type) || []).slice(0, 5),
      }));

    // Intentionally strict: schema validity does not imply runtime support.
    // This test stays red until every dispatchable type used by shipped cards
    // has a registered handler (or a declared runtime owner).
    const report = unowned.map(({ type, usedByShippedCards, exampleLocations }) =>
      `${type} [used=${usedByShippedCards}] e.g. ${exampleLocations.join("; ")}`);
    expect(report).toEqual([]);
  });

  test("every registered handler name is a cataloged DSL type", () => {
    const unknown = initEffectResolver().names().filter((type) => !NODE_TYPES.has(type));
    expect(unknown).toEqual([]);
  });

  test("structural node types are resolved inside EffectResolver, not dispatched to handlers", async () => {
    const registered = new Set(initEffectResolver().names());
    const resolverSource = await fs.readFile(
      path.join(projectRoot, "server", "game", "EffectResolver.js"),
      "utf-8"
    );
    const problems = [];
    for (const type of dslCatalog.structural) {
      if (registered.has(type)) {
        problems.push(`structural type "${type}" is registered as a handler`);
      }
      if (!resolverSource.includes(`type === "${type}"`)) {
        problems.push(`EffectResolver does not structurally resolve "${type}"`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("every cataloged modifier type is owned by ModifierService", () => {
    const unowned = dslCatalog.modifiers.filter((type) => !MODIFIER_TYPES.has(type));
    expect(unowned).toEqual([]);
  });

  test("every cataloged landmark rule type is owned by GlobalRuleRegistry", () => {
    const unowned = dslCatalog.rules.filter((type) => !RULE_TYPES.has(type));
    expect(unowned).toEqual([]);
  });

  test("trigger wiring is classified per owner (report, not a failure)", async () => {
    const { triggerTypes } = collectInventory(cardsData);
    const used = [...triggerTypes.keys()].sort();

    const wired = new Set();
    for (const owner of ["TriggerManager.js", "PassiveManager.js"]) {
      const source = await fs.readFile(
        path.join(projectRoot, "server", "game", "services", owner),
        "utf-8"
      );
      for (const match of source.matchAll(/trigger\.type === "([a-z_]+)"/g)) wired.add(match[1]);
      for (const match of source.matchAll(/case "([a-z_]+)":/g)) wired.add(match[1]);
    }

    const report = {
      wired: used.filter((type) => wired.has(type)),
      usedButUnwired: used.filter((type) => !wired.has(type)),
      catalogedButUnused: dslCatalog.triggers.filter((type) => !triggerTypes.has(type)),
    };
    // Gameplay wiring is owned by the trigger/passive plans; this audit only
    // reports which used trigger types have no subscription owner today.
    // eslint-disable-next-line no-console
    console.log(`[trigger wiring audit] ${JSON.stringify(report)}`);
  });
});
