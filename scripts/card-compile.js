import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import Ajv from "ajv";

const currentFile = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(currentFile), "..");
const cardsDirectory = path.join(projectRoot, "data", "cards");
const outputPath = path.join(projectRoot, "server", "data", "cards.json");
const iconsDir = path.join(projectRoot, "public", "assets", "icons");
const validatorPath = path.join(projectRoot, "scripts", "card-validate.js");
const compiledSchemaPath = path.join(projectRoot, "schemas", "compiled-cards.schema.json");

// ── Code mapping helpers ────────────────────────────────────────────────────

function toCode(str) {
  return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

// Position display name → internal code
const positionCodeMap = {
  "fisherman": "fisherman",
  "light bearer": "light-bearer",
  "scout": "scout",
  "spear bearer": "spear-bearer",
  "wave controller": "wave-controller",
  "frontline shinheuh": "frontline-shinheuh",
  "backline shinheuh": "backline-shinheuh",
  "landmark": "landmark",
};

// Attribute display name → internal code
const attributeCodeMap = {
  "anima": "anima",
  "silver dwarf": "silver-dwarf",
  "red witch": "red-witch",
  "hwayeomsa": "hwayeomsa",
  "jeonsulsa": "jeonsulsa",
  "irregular": "irregular",
  "living ignition weapon": "living-ignition-weapon",
};

// ── Trait parsing ───────────────────────────────────────────────────────────

function parseTrait(raw) {
  const str = String(raw).trim();
  const match = /^(.+?)(?:\s+(\d+))?$/i.exec(str);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const value = match[2] ? parseInt(match[2], 10) : null;
  return {
    code: name.replace(/\s+/g, "-"), // matches traits.json keys (e.g. "last-one-standing")
    value: value,
  };
}

// ── Unified DSL object factory ──────────────────────────────────────────────
// All effect-like things (abilities, passives, effects, triggers) use the
// same shape. `type: "custom"` means "hand-written handler needed."
// Phase 4 expands the pattern matcher to produce typed objects like
// `{ type: "deal_damage", target: "enemy", amount: 7 }`.

function dslObject(raw, handler = null, extras = {}) {
  return { type: "custom", raw, handler, ...extras };
}

const conditionNames = new Set([
  "burned", "cursed", "doomed", "exhausted", "frozen", "ghost",
  "heavy", "poisoned", "rooted", "stunned", "weak",
]);

const traitNames = new Set([
  "barrier", "bloodthirsty", "creator", "dealer", "immune",
  "last one standing", "lethal", "pierce", "reflect", "regenerate",
  "resilient", "ruthless", "sharpshooter", "strong", "taunt", "vengeful",
]);

const targetAliases = new Map([
  ["me", "self"],
  ["i", "self"],
  ["the bearer", "bearer"],
  ["an ally", "ally"],
  ["all allies", "all_allies"],
  ["an enemy", "enemy"],
  ["a frontline enemy", "enemy_frontline"],
  ["a backline enemy", "enemy_backline"],
  ["all enemies", "all_enemies"],
  ["a unit", "unit"],
]);

function normalizeTarget(rawTarget) {
  const target = String(rawTarget).trim().toLowerCase().replace(/\s+/g, " ");
  return targetAliases.get(target) || null;
}

function parseTargetWithCondition(rawTarget) {
  const targetText = String(rawTarget).trim();
  const target = normalizeTarget(targetText);
  if (target) return { target };

  const conditionalTarget = /^(an enemy|all enemies) with ([a-z ]+?)(?:\s+(\d+)\+?)?$/i.exec(targetText);
  if (conditionalTarget && conditionNames.has(conditionalTarget[2].toLowerCase())) {
    return {
      target: normalizeTarget(conditionalTarget[1]),
      condition: conditionalTarget[2].toLowerCase(),
      conditionValue: conditionalTarget[3] ? Number(conditionalTarget[3]) : undefined,
    };
  }

  const prefixedCondition = /^all ([a-z ]+?)(?:\s+(\d+)\+?)? enemies$/i.exec(targetText);
  if (prefixedCondition && conditionNames.has(prefixedCondition[1].toLowerCase())) {
    return {
      target: "all_enemies",
      condition: prefixedCondition[1].toLowerCase(),
      conditionValue: prefixedCondition[2] ? Number(prefixedCondition[2]) : undefined,
    };
  }

  return null;
}

function parseSimpleTarget(rawTarget) {
  const target = normalizeTarget(rawTarget);
  if (target) return { target };

  const multipleEnemies = /^(\d+) enemies$/i.exec(String(rawTarget).trim());
  if (multipleEnemies) return { target: "enemies", count: Number(multipleEnemies[1]) };

  return null;
}

function parseEffectText(raw) {
  const sourceText = String(raw);
  const text = sourceText.trim();
  const abilityMatch = /^ability:\s*(.+)$/i.exec(text);
  if (abilityMatch) {
    const ability = parseEffectWithMetadata(abilityMatch[1]) || dslObject(abilityMatch[1].trim());
    return {
      type: "grant_ability",
      target: "bearer",
      ability,
      raw: sourceText,
      handler: null,
    };
  }

  const spendMatch = /^spend\s+(\d+):\s*(.+)$/i.exec(text);
  if (spendMatch) {
    return {
      type: "spend_shinsu",
      amount: Number(spendMatch[1]),
      effect: parseEffectWithMetadata(spendMatch[2]) || dslObject(spendMatch[2].trim()),
      raw: sourceText,
      handler: null,
    };
  }

  const createMatch = /^create\s+(\d+)$/i.exec(text);
  if (createMatch) {
    return { type: "create_lighthouse", amount: Number(createMatch[1]), raw: sourceText, handler: null };
  }

  const compressMatch = /^compress\s+(\d+)$/i.exec(text);
  if (compressMatch) {
    return { type: "compress_shinsu", amount: Number(compressMatch[1]), raw: sourceText, handler: null };
  }

  const chargeMatch = /^charge\s+(\d+)$/i.exec(text);
  if (chargeMatch) {
    return { type: "charge_shinsu", amount: Number(chargeMatch[1]), raw: sourceText, handler: null };
  }

  const destroyMatch = /^destroy\s+(\d+)$/i.exec(text);
  if (destroyMatch) {
    return { type: "destroy_lighthouse", amount: Number(destroyMatch[1]), raw: sourceText, handler: null };
  }

  const reclaimMatch = /^reclaim\s+(\d+)$/i.exec(text);
  if (reclaimMatch) {
    return { type: "reclaim_cards", amount: Number(reclaimMatch[1]), raw: sourceText, handler: null };
  }

  const cleanseMatch = /^cleanse(?:\s+(.+))?$/i.exec(text);
  if (cleanseMatch) {
    const target = cleanseMatch[1] ? parseSimpleTarget(cleanseMatch[1]) : { target: "self" };
    if (target) return { type: "cleanse", ...target, raw: sourceText, handler: null };
  }

  const dealMatch = /^deal\s+(\d+)\s+to\s+(.+)$/i.exec(text);
  if (dealMatch) {
    const target = parseTargetWithCondition(dealMatch[2]);
    if (target) {
      return { type: "deal_damage", amount: Number(dealMatch[1]), ...target, raw: sourceText, handler: null };
    }
  }

  const healMatch = /^heal\s+(.+?)\s+(\d+)\s*hp$/i.exec(text);
  if (healMatch) {
    const target = parseSimpleTarget(healMatch[1]);
    if (target) {
      return { type: "heal", amount: Number(healMatch[2]), ...target, raw: sourceText, handler: null };
    }
  }

  const giveConditionMatch = /^give\s+([a-z]+)(?:\s+(\d+))?\s+to\s+(.+)$/i.exec(text);
  if (giveConditionMatch && conditionNames.has(giveConditionMatch[1].toLowerCase())) {
    const target = parseSimpleTarget(giveConditionMatch[3]);
    if (target) {
      return {
        type: "give_condition",
        condition: giveConditionMatch[1].toLowerCase(),
        ...(giveConditionMatch[2] ? { amount: Number(giveConditionMatch[2]) } : {}),
        ...target,
        raw: sourceText,
        handler: null,
      };
    }
  }

  const traitMatch = /^(the bearer|i)\s+has\s+(.+?)(?:\s+(\d+))?$/i.exec(text);
  if (traitMatch && traitNames.has(traitMatch[2].toLowerCase())) {
    return {
      type: "grant_trait",
      target: traitMatch[1].toLowerCase() === "i" ? "self" : "bearer",
      trait: traitMatch[2].toLowerCase(),
      ...(traitMatch[3] ? { amount: Number(traitMatch[3]) } : {}),
      raw: sourceText,
      handler: null,
    };
  }

  return null;
}

function parseEffectWithMetadata(raw) {
  const sourceText = String(raw);
  const text = sourceText.trim();
  const positionMatch = /^(.+?):\s*(.+)$/.exec(text);
  const position = positionMatch
    ? positionCodeMap[positionMatch[1].trim().toLowerCase()] || null
    : null;
  const effectText = position ? positionMatch[2].trim() : text;
  const quick = /^quick:?\s*/i.test(effectText);
  const normalizedEffect = quick ? effectText.replace(/^quick:?\s*/i, "").trim() : effectText;
  const parsed = parseEffectText(normalizedEffect);

  if (!parsed) return null;
  return { ...parsed, raw: sourceText, ...(quick ? { quick: true } : {}), ...(position ? { position } : {}) };
}

// ── Effect compilation (keyword expansion) ──────────────────────────────────

const UNREACHABLE_KEYWORDS = new Set([
  "unreachable", "unreachable.",
]);

function isUnreachableKeyword(text) {
  const t = text.trim().toLowerCase().replace(/[.]$/, "");
  return UNREACHABLE_KEYWORDS.has(t);
}

function compileEffects(rawEffects) {
  const compiled = [];
  const deckConstraints = [];

  for (const effect of rawEffects) {
    const sourceText = String(effect);
    const str = sourceText.trim();
    if (!str) continue;

    // Check for "Unreachable" keyword → deck constraint
    if (isUnreachableKeyword(str)) {
      deckConstraints.push({ type: "unreachable" });
      // Also keep the effect in compiled effects as a note
      compiled.push(dslObject(sourceText, "UnreachableKeyword"));
      continue;
    }

    if (/^quick:?$/i.test(str)) {
      compiled.push(dslObject(sourceText, null, { quick: true }));
      continue;
    }

    compiled.push(parseEffectWithMetadata(sourceText) || dslObject(sourceText));
  }

  return { effects: compiled, deckConstraints };
}

// ── Ability/Passive compilation ─────────────────────────────────────────────
// Both produce the same unified DSL shape as effects.
// Phase 4: `type` changes from "custom" to structured types as the pattern matcher grows.

function compileAbility(raw) {
  const sourceText = String(raw);
  const str = sourceText.trim();
  if (!str) return null;

  let position = null;
  let effectText = str;

  // Check for position-scoped ability: "position: effect"
  const positionMatch = /^(.+?):\s*(.+)$/.exec(str);
  if (positionMatch) {
    const posName = positionMatch[1].trim().toLowerCase();
    const knownPosition = positionCodeMap[posName];
    if (knownPosition) {
      position = knownPosition;
      effectText = positionMatch[2].trim();
    }
  }

  // Check for Quick keyword
  const quickRegex = /^quick:?\s*/i;
  const isQuick = quickRegex.test(effectText);
  if (isQuick) {
    effectText = effectText.replace(quickRegex, "").trim();
  }

  const parsed = parseEffectText(effectText);
  if (parsed) {
    return { ...parsed, raw: sourceText, quick: isQuick, position };
  }

  return dslObject(sourceText, null, { quick: isQuick, position });
}

function compilePassive(raw) {
  const sourceText = String(raw);
  const str = sourceText.trim();
  if (!str) return null;

  let position = null;
  let effectText = str;

  // Check for position-scoped passive
  const positionMatch = /^(.+?):\s*(.+)$/.exec(str);
  if (positionMatch) {
    const posName = positionMatch[1].trim().toLowerCase();
    const knownPosition = positionCodeMap[posName];
    if (knownPosition) {
      position = knownPosition;
      effectText = positionMatch[2].trim();
    }
  }

  return dslObject(sourceText, null, { position });
}

// ── Cross-reference resolution ──────────────────────────────────────────────

function resolveEvolveInto(card, allCards) {
  if (card.type !== "unit") return null;
  const evolveTriggers = card.evolve;
  if (!Array.isArray(evolveTriggers) || evolveTriggers.length === 0) return null;

  // Find the evolved form of this card
  // Convention: "{name} (evolved)" or "{name} evolved"
  const expectedName = card.name + " (evolved)";
  const evolvedCard = allCards.find((c) => c.name === expectedName);

  if (!evolvedCard) return null;

  // Build trigger description from evolve list
  const triggerRaw = evolveTriggers
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join("; ");

  return {
    trigger: { type: "custom", raw: triggerRaw, handler: null },
    cardId: evolvedCard.cardId,
  };
}

function resolveEvolvedFrom(card, allCards) {
  if (card.type !== "unit") return null;
  // Check if this is an evolved card: name contains "(evolved)"
  if (!card.name.toLowerCase().includes("(evolved)")) return null;

  const baseName = card.name.replace(/\s*\(evolved\)\s*/i, "").trim();
  const baseCard = allCards.find((c) => c.name === baseName);
  return baseCard ? baseCard.cardId : null;
}

function resolveIgniteInto(card, allCards) {
  if (card.type !== "equipment") return null;
  const ignitionTriggers = card.ignition;
  if (!Array.isArray(ignitionTriggers) || ignitionTriggers.length === 0) return null;

  // Find the ignited form: "{name} (ignited)"
  const expectedName = card.name + " (ignited)";
  const ignitedCard = allCards.find((c) => c.name === expectedName);

  if (!ignitedCard) return null;

  const triggerRaw = ignitionTriggers
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .join("; ");

  return {
    trigger: { type: "custom", raw: triggerRaw, handler: null },
    cardId: ignitedCard.cardId,
  };
}

function resolveIgnitedFrom(card, allCards) {
  if (card.type !== "equipment") return null;
  if (!card.name.toLowerCase().includes("(ignited)")) return null;

  const baseName = card.name.replace(/\s*\(ignited\)\s*/i, "").trim();
  const baseCard = allCards.find((c) => c.name === baseName);
  return baseCard ? baseCard.cardId : null;
}

// ── Card compilation ────────────────────────────────────────────────────────

function compileCard(rawCard, allCards) {
  const type = rawCard.type;

  // Base fields
  const compiled = {
    cardId: null, // assigned after sorting
    type: type,
    name: rawCard.name || "",
    sobriquet: rawCard.sobriquet || null,
    cost: rawCard.cost ?? 0,
  };

  if (type === "unit") {
    compiled.hp = rawCard.hp ?? 0;
    compiled.rank = rawCard.rank || null;

    // Positions
    compiled.positions = (rawCard.positions || []).map(
      (p) => positionCodeMap[p.toLowerCase()] || toCode(p)
    );

    // Traits — { code, value? } objects (value only present for numeric traits)
    const parsedTraits = (rawCard.traits || [])
      .map(parseTrait)
      .filter(Boolean);
    compiled.traits = parsedTraits.map((t) => {
      if (t.value !== null) return { code: t.code, value: t.value };
      return { code: t.code };
    });

    // Attributes
    compiled.attributes = (rawCard.attributes || []).map(
      (a) => attributeCodeMap[a.toLowerCase()] || toCode(a)
    );

    // Affiliations
    compiled.affiliations = (rawCard.affiliations || []).map(toCode);

    // Abilities — unified DSL objects (same shape as effects)
    compiled.abilities = (rawCard.abilities || [])
      .map(compileAbility)
      .filter(Boolean);

    // Passives — unified DSL objects (same shape as effects)
    compiled.passives = (rawCard.passives || [])
      .map(compilePassive)
      .filter(Boolean);

    // Evolution (computed after all cards have cardIds)
    compiled._evolveRaw = rawCard.evolve || [];
    compiled.evolveInto = null;
    compiled.evolvedFrom = null;

    // Deck constraints (units can have "unreachable" keyword too)
    compiled.deckConstraints = [];

    // Effects/Requirements not applicable to units
    compiled.requirements = [];
    compiled.effects = [];
    compiled.igniteInto = null;
    compiled.ignitedFrom = null;
  }

  if (type === "skill") {
    compiled.requirements = rawCard.requirements || [];

    const { effects, deckConstraints } = compileEffects(rawCard.effects || []);
    compiled.effects = effects;
    compiled.deckConstraints = deckConstraints;

    // Not applicable to skills
    compiled.hp = null;
    compiled.rank = null;
    compiled.positions = [];
    compiled.traits = [];
    compiled.attributes = [];
    compiled.affiliations = [];
    compiled.abilities = [];
    compiled.passives = [];
    compiled.evolveInto = null;
    compiled.evolvedFrom = null;
    compiled.igniteInto = null;
    compiled.ignitedFrom = null;
  }

  if (type === "equipment") {
    compiled.requirements = rawCard.requirements || [];

    const { effects, deckConstraints } = compileEffects(rawCard.effects || []);
    compiled.effects = effects;
    compiled.deckConstraints = deckConstraints;

    // Ignition (computed after all cards have cardIds)
    compiled._ignitionRaw = rawCard.ignition || [];
    compiled.igniteInto = null;
    compiled.ignitedFrom = null;

    // Not applicable to equipment
    compiled.hp = null;
    compiled.rank = null;
    compiled.positions = [];
    compiled.traits = [];
    compiled.attributes = [];
    compiled.affiliations = [];
    compiled.abilities = [];
    compiled.passives = [];
    compiled.evolveInto = null;
    compiled.evolvedFrom = null;
  }

  return compiled;
}

function cleanCompiled(card) {
  // Remove internal temporary fields
  delete card._evolveRaw;
  delete card._ignitionRaw;

  // Delete optional single-value fields when null (sparse schema per plan)
  if (card.sobriquet === null) delete card.sobriquet;
  if (card.rank === null) delete card.rank;
  if (card.hp === null) delete card.hp;
  if (card.evolveInto === null) delete card.evolveInto;
  if (card.evolvedFrom === null) delete card.evolvedFrom;
  if (card.igniteInto === null) delete card.igniteInto;
  if (card.ignitedFrom === null) delete card.ignitedFrom;

  // Delete type-inappropriate empty arrays (sparse schema per plan)
  // Unit-only arrays — remove from non-unit cards
  if (card.type !== "unit") {
    if (!card.positions || card.positions.length === 0) delete card.positions;
    if (!card.traits || card.traits.length === 0) delete card.traits;
    if (!card.attributes || card.attributes.length === 0) delete card.attributes;
    if (!card.affiliations || card.affiliations.length === 0) delete card.affiliations;
    if (!card.abilities || card.abilities.length === 0) delete card.abilities;
    if (!card.passives || card.passives.length === 0) delete card.passives;
  }
  // Skill/equipment-only arrays
  if (card.requirements && card.requirements.length === 0) delete card.requirements;
  if (card.effects && card.effects.length === 0) delete card.effects;

  return card;
}

// ── Icon checking ───────────────────────────────────────────────────────────

async function checkIcons(cards) {
  const missingIcons = [];
  const neededIcons = new Set();

  // Collect all trait codes (now objects with .code)
  for (const card of cards) {
    for (const trait of card.traits || []) {
      neededIcons.add(`traits/${trait.code}.png`);
    }
  }

  // Collect all position codes
  for (const card of cards) {
    for (const posCode of card.positions || []) {
      neededIcons.add(`positions/${posCode}.png`);
    }
  }

  // Collect all attribute codes
  for (const card of cards) {
    for (const attrCode of card.attributes || []) {
      neededIcons.add(`attributes/${attrCode}.png`);
    }
  }

  // Conditions - check against known list, now in conditions/ folder
  const conditionCodes = [
    "burned", "cursed", "doomed", "exhausted", "frozen",
    "ghost", "heavy", "poisoned", "rooted", "stunned", "weak",
  ];
  for (const code of conditionCodes) {
    neededIcons.add(`conditions/${code}.png`);
  }

  // Check which files exist
  for (const iconPath of neededIcons) {
    const fullPath = path.join(iconsDir, iconPath);
    try {
      await fs.access(fullPath);
    } catch {
      missingIcons.push(iconPath);
    }
  }

  return missingIcons;
}

// ── Main ────────────────────────────────────────────────────────────────────

const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
};

async function main() {
  // Source YAML is the only authoring input. Never compile unvalidated cards.
  execFileSync(process.execPath, [validatorPath], {
    cwd: projectRoot,
    stdio: "inherit",
  });

  // 1. Read all YAML files
  const entries = await fs.readdir(cardsDirectory);
  const yamlFiles = entries
    .filter((e) => e.endsWith(".yml") || e.endsWith(".yaml"))
    .sort(); // alphabetical for stable ordering

  const rawCards = [];
  const errors = [];

  for (const file of yamlFiles) {
    try {
      const raw = await fs.readFile(path.join(cardsDirectory, file), "utf-8");
      const card = yaml.load(raw);
      if (card && card.type) {
        rawCards.push(card);
      } else {
        errors.push(`${file}: No valid card data found`);
      }
    } catch (err) {
      errors.push(`${file}: YAML parse error - ${err.message}`);
    }
  }

  if (errors.length > 0) {
    console.error(`${colors.red}Errors loading cards:${colors.reset}`);
    errors.forEach((e) => console.error(`  ${colors.red}✗${colors.reset} ${e}`));
    process.exitCode = 1;
    return;
  }

  // 2. Sort by name for stable cardId assignment
  rawCards.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  // 3. Assign cardIds
  rawCards.forEach((card, index) => {
    card._tempId = index;
  });

  // 4. First pass: compile all cards with temporary IDs
  const compiledCards = rawCards.map((raw) => compileCard(raw, rawCards.map((r) => ({
    name: r.name,
    cardId: r._tempId,
  }))));

  // Assign temporary cardIds
  compiledCards.forEach((card, index) => {
    card.cardId = rawCards[index]._tempId;
  });

  // 5. Resolve cross-references (evolve/ignite)
  for (const compiled of compiledCards) {
    const rawCard = rawCards.find((r) => r.name === compiled.name);
    if (!rawCard) continue;

    // Build list of all cards with their IDs for cross-referencing
    const allWithIds = compiledCards.map((c) => ({
      name: c.name,
      cardId: c.cardId,
    }));

    // Evolution
    if (compiled.type === "unit" && rawCard.evolve && rawCard.evolve.length > 0) {
      compiled.evolveInto = resolveEvolveInto(
        { ...rawCard, name: compiled.name },
        allWithIds
      );
    }
    compiled.evolvedFrom = resolveEvolvedFrom(
      { ...rawCard, name: compiled.name, type: compiled.type },
      allWithIds
    );

    // Ignition
    if (compiled.type === "equipment" && rawCard.ignition && rawCard.ignition.length > 0) {
      compiled.igniteInto = resolveIgniteInto(
        { ...rawCard, name: compiled.name },
        allWithIds
      );
    }
    compiled.ignitedFrom = resolveIgnitedFrom(
      { ...rawCard, name: compiled.name, type: compiled.type },
      allWithIds
    );
  }

  // 6. Clean up temporary fields
  const finalCards = compiledCards.map(cleanCompiled);

  const compiledSchema = JSON.parse(await fs.readFile(compiledSchemaPath, "utf-8"));
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validateCompiled = ajv.compile(compiledSchema);

  // 7. Convert to keyed object (by cardId as string)
  const output = {};
  for (const card of finalCards) {
    output[String(card.cardId)] = card;
  }

  if (!validateCompiled(output)) {
    const details = (validateCompiled.errors || [])
      .map((error) => `${error.instancePath || "output"}: ${error.message}`)
      .join("\n  ");
    throw new Error(`Compiled card data failed ${path.relative(projectRoot, compiledSchemaPath)}:\n  ${details}`);
  }

  // 8. Write output
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(output, null, 2) + "\n", "utf-8");

  // 9. Check icons
  const missingIcons = await checkIcons(finalCards);

  // 10. Report
  console.log(`${colors.green}✓ Compiled ${finalCards.length} cards to ${path.relative(projectRoot, outputPath)}${colors.reset}`);

  const units = finalCards.filter((c) => c.type === "unit").length;
  const skills = finalCards.filter((c) => c.type === "skill").length;
  const equipment = finalCards.filter((c) => c.type === "equipment").length;
  console.log(`  Units: ${units}  Skills: ${skills}  Equipment: ${equipment}`);

  const evolveCount = finalCards.filter((c) => c.evolveInto).length;
  const igniteCount = finalCards.filter((c) => c.igniteInto).length;
  if (evolveCount > 0) console.log(`  Evolution chains: ${evolveCount}`);
  if (igniteCount > 0) console.log(`  Ignition chains: ${igniteCount}`);

  if (missingIcons.length > 0) {
    console.log(`\n${colors.yellow}⚠ Missing ${missingIcons.length} icon(s):${colors.reset}`);
    missingIcons.forEach((icon) => console.log(`  - ${icon}`));
  }
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
  console.error(error.stack);
  process.exitCode = 1;
});
