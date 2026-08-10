/**
 * Validates skill/equipment/ability requirements before card play or use.
 *
 * Requirements are raw strings from compiled card data.
 * All 9 requirement patterns in the current card set are enforced.
 * Unknown patterns throw — no silent pass-through.
 *
 * Validation happens BEFORE cost deduction to prevent partial state.
 */

// ── Field helpers ───────────────────────────────────────────────────────────

function allOwnUnits(username, gameState) {
  const field = gameState.playerStates[username]?.field;
  if (!field) return [];
  return [...(field.frontline || []), ...(field.backline || [])].filter((u) => u.isAlive());
}

function hasAffiliation(unit, affCode) {
  const affs = unit.card?.affiliations;
  if (!affs) return false;
  // affiliations is a dictionary (name→code mapping, not array)
  return typeof affs.flat === "function" ? affs.includes(affCode) : affCode in (affs || {});
}

function hasAttribute(unit, attrCode) {
  return (unit.card?.attributes || []).includes(attrCode) ||
    gameState.modifierStack?.has(unit.id, "attribute", attrCode);
}

function hasAffiliationOnBoard(units, affCode, gameState) {
  return units.some((u) =>
    hasAffiliation(u, affCode) ||
    gameState.modifierStack?.has(u.id, "affiliation", affCode)
  );
}

function hasAttributeOnBoard(units, attrCode, gameState) {
  return units.some((u) => hasAttribute(u, attrCode));
}

// ── Single-requirement resolvers ────────────────────────────────────────────

function checkDeployedAs(text, ctx) {
  const deployedMatch = /^deployed as (.+)$/.exec(text);
  if (!deployedMatch) return false;
  const requiredPos = deployedMatch[1].trim();
  if (!ctx.sourceUnit || ctx.sourceUnit.placedPositionCode !== requiredPos) {
    throw new Error(`Requirement not met: must be deployed as ${requiredPos}`);
  }
  return true;
}

function checkTargetAlly(text, ctx) {
  if (!text.includes("target is an ally")) return false;
  if (!ctx.targetUnit || !ctx.sourceUnit) {
    throw new Error("Requirement not met: target must be an ally");
  }
  if (ctx.targetUnit.owner !== ctx.sourceUnit.owner) {
    throw new Error("Requirement not met: target must be an ally");
  }
  return true;
}

function checkTargetEnemy(text, ctx) {
  if (!text.includes("target is an enemy")) return false;
  if (!ctx.targetUnit || !ctx.sourceUnit) {
    throw new Error("Requirement not met: target must be an enemy");
  }
  if (ctx.targetUnit.owner === ctx.sourceUnit.owner) {
    throw new Error("Requirement not met: target must be an enemy");
  }
  return true;
}

function checkTargetRank(text, ctx) {
  const rankMatch = /^target is (?:a |an )?(regular|ranker|high ranker)$/.exec(text);
  if (!rankMatch) return false;
  if (!ctx.targetUnit || ctx.targetUnit.card?.rank !== rankMatch[1]) {
    throw new Error(`Requirement not met: target must be a ${rankMatch[1]}`);
  }
  return true;
}

function checkSpecificName(text, ctx) {
  const nameMatch = /^(.+?) is in your board$/.exec(text);
  if (!nameMatch) return false;
  const requiredName = nameMatch[1].trim();
  const units = allOwnUnits(ctx.username, ctx.gameState);
  if (!units.some((u) => u.card?.name?.toLowerCase() === requiredName.toLowerCase())) {
    throw new Error(`Requirement not met: ${requiredName} must be deployed on your board`);
  }
  return true;
}

function checkFirstCardOfRound(text, ctx) {
  if (text !== "i'm the first card you play this round") return false;
  const count = ctx.gameState._cardsPlayedThisRound?.get(ctx.username) || 0;
  if (count > 0) {
    throw new Error("Requirement not met: must be the first card you play this round");
  }
  return true;
}

function checkAffiliation(text, ctx) {
  // "khun family member" (bare affiliation)
  const affMatch = /^([a-z ]+ family) member$/.exec(text);
  if (!affMatch) return false;
  const requiredAff = affMatch[1].trim().replace(/\s+/g, "-");
  const units = allOwnUnits(ctx.username, ctx.gameState);
  if (!hasAffiliationOnBoard(units, requiredAff, ctx.gameState)) {
    throw new Error(`Requirement not met: need an allied ${affMatch[1].trim()} on your board`);
  }
  return true;
}

function checkAffiliationOrAttribute(text, ctx) {
  // "you have an ally yeon family member or Hwayeomsa"
  const match = /^you have an ally (.+?) or (.+)$/.exec(text);
  if (!match) return false;

  const partA = match[1].trim().replace(/\s+/g, "-");
  const partB = match[2].trim().toLowerCase();

  // Try part A as affiliation, part B as attribute
  const affCode = partA.replace(/-/g, " "); // "yeon-family" → "yeon family"
  const isAff = affCode.endsWith("family");
  const isAttrB = ["anima", "silver dwarf", "red witch", "hwayeomsa",
    "jeonsulsa", "irregular", "living ignition weapon"].includes(
      partB.replace(/-/g, " ")
    );
  const attrCodeB = partB.replace(/\s+/g, "-");

  const units = allOwnUnits(ctx.username, ctx.gameState);
  const hasAff = isAff && hasAffiliationOnBoard(units, partA, ctx.gameState);
  const hasAttr = isAttrB && hasAttributeOnBoard(units, attrCodeB, ctx.gameState);

  if (!hasAff && !hasAttr) {
    throw new Error(`Requirement not met: need an allied ${match[1]} or ${match[2]} on your board`);
  }
  return true;
}

function checkAllyWithAttribute(text, ctx) {
  // "have an ally Irregular"
  const match = /^have an ally (.+)$/.exec(text);
  if (!match) return false;
  const attrName = match[1].trim().toLowerCase();
  const attrCode = attrName.replace(/\s+/g, "-");
  const units = allOwnUnits(ctx.username, ctx.gameState);
  if (!units.some((u) =>
    (u.card?.attributes || []).includes(attrCode) ||
    ctx.gameState.modifierStack.has(u.id, "attribute", attrCode)
  )) {
    throw new Error(`Requirement not met: need an allied ${attrName} on your board`);
  }
  return true;
}

// ── Main validator ──────────────────────────────────────────────────────────

export default class RequirementValidator {
  /**
   * @param {string[]} requirements
   * @param {object} ctx — { gameState, username, sourceUnit?, targetUnit?, card? }
   */
  static validate(requirements, ctx) {
    if (!requirements || requirements.length === 0) return;
    if (!ctx.username) throw new Error("RequirementValidator: ctx.username is required");

    const { gameState } = ctx;

    for (const req of requirements) {
      const text = String(req).trim().toLowerCase();

      if (checkDeployedAs(text, ctx)) continue;
      if (checkTargetAlly(text, ctx)) continue;
      if (checkTargetEnemy(text, ctx)) continue;
      if (checkTargetRank(text, ctx)) continue;
      if (checkSpecificName(text, ctx)) continue;
      if (checkFirstCardOfRound(text, ctx)) continue;
      if (checkAffiliationOrAttribute(text, ctx)) continue;
      if (checkAffiliation(text, ctx)) continue;
      if (checkAllyWithAttribute(text, ctx)) continue;

      throw new Error(
        `Unsupported requirement: "${req}". Add a check to RequirementValidator.`
      );
    }
  }
}
