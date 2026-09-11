/**
 * Validates skill/equipment/ability requirements before card play or use.
 *
 * Requirements are structured check objects from compiled card data (see the
 * requirements grammar in docs/COMPILED_CARD_DSL.md). Each `type` is evaluated
 * against the play context; unknown types throw — no silent pass-through.
 *
 * Validation happens BEFORE cost deduction to prevent partial state.
 *
 * `target_side` validates in two modes:
 * - With an explicit `ctx.targetUnit` (equipment attachment), the named unit
 *   is checked against the source side.
 * - Without one (skill/ability plays, where no target exists at validation
 *   time — it is chosen through target resolution after the play), `ally`
 *   requires that a legal allied target exists on the board.
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

function hasAttribute(unit, attrCode, gameState) {
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
  return units.some((u) => hasAttribute(u, attrCode, gameState));
}

function hasGrantedAffiliation(unit, affCode, gameState) {
  return hasAffiliation(unit, affCode) ||
    gameState.modifierStack?.has(unit.id, "affiliation", affCode);
}

// ── Single-requirement checks ───────────────────────────────────────────────

const REQUIREMENT_CHECKS = {
  deployed_as(req, ctx) {
    if (!ctx.sourceUnit || ctx.sourceUnit.placedPositionCode !== req.position) {
      throw new Error(`Requirement not met: must be deployed as ${req.position.replace(/-/g, " ")}`);
    }
  },

  target_side(req, ctx) {
    if (req.side === "enemy") {
      if (!ctx.targetUnit || !ctx.sourceUnit) {
        throw new Error("Requirement not met: target must be an enemy");
      }
      if (ctx.targetUnit.owner === ctx.sourceUnit.owner) {
        throw new Error("Requirement not met: target must be an enemy");
      }
      return;
    }
    if (!ctx.targetUnit) {
      if (allOwnUnits(ctx.username, ctx.gameState).length === 0) {
        throw new Error("Requirement not met: need an allied unit on your board");
      }
      return;
    }
    const sourceOwner = ctx.sourceUnit?.owner ?? ctx.username;
    if (ctx.targetUnit.owner !== sourceOwner) {
      throw new Error("Requirement not met: target must be an ally");
    }
  },

  bearer_has(req, ctx) {
    // The source unit itself (the equipment's bearer) must carry the stated
    // affiliation and/or attribute — other allied units on the board don't
    // satisfy this check.
    const unit = ctx.sourceUnit;
    const hasAff = unit && req.affiliation && hasGrantedAffiliation(unit, req.affiliation, ctx.gameState);
    const hasAttr = unit && req.attribute && hasAttribute(unit, req.attribute, ctx.gameState);
    if (!hasAff && !hasAttr) {
      throw new Error(`Requirement not met: ${req.raw}`);
    }
  },

  unit_on_board(req, ctx) {
    const units = allOwnUnits(ctx.username, ctx.gameState);
    if (!units.some((u) => u.card?.name?.toLowerCase() === req.name.toLowerCase())) {
      throw new Error(`Requirement not met: ${req.name} must be deployed on your board`);
    }
  },

  first_card_this_round(req, ctx) {
    const count = ctx.gameState._cardsPlayedThisRound?.get(ctx.username) || 0;
    if (count > 0) {
      throw new Error("Requirement not met: must be the first card you play this round");
    }
  },

  has_ally(req, ctx) {
    const units = allOwnUnits(ctx.username, ctx.gameState);
    const hasAff = req.affiliation && hasAffiliationOnBoard(units, req.affiliation, ctx.gameState);
    const hasAttr = req.attribute && hasAttributeOnBoard(units, req.attribute, ctx.gameState);
    if (!hasAff && !hasAttr) {
      throw new Error(`Requirement not met: ${req.raw}`);
    }
  },
};

// ── Main validator ──────────────────────────────────────────────────────────

export default class RequirementValidator {
  /**
   * @param {object[]} requirements — compiled requirement check objects
   * @param {object} ctx — { gameState, username, sourceUnit?, targetUnit?, card? }
   */
  static validate(requirements, ctx) {
    if (!requirements || requirements.length === 0) return;
    if (!ctx.username) throw new Error("RequirementValidator: ctx.username is required");

    for (const req of requirements) {
      const check = REQUIREMENT_CHECKS[req?.type];
      if (!check) {
        throw new Error(
          `Unsupported requirement type: "${req?.type}". List it in schemas/dsl-catalog.json and implement it in RequirementValidator.`
        );
      }
      check(req, ctx);
    }
  }
}
