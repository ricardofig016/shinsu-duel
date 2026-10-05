/**
 * The turn-option projection: every player action a seat may submit right now,
 * read from that seat's own redacted view alone.
 *
 * The engine's `validate()` preconditions live in seven action handlers; this
 * module mirrors them in one place so a bot policy samples a pool instead of
 * restating them. It is a pure function of the view — no `GameState`, no
 * catalog fetch, no filesystem — and the contract suite in
 * `server/bots/tests/turnOptions.test.js` feeds every projected move back to
 * `processAction`, which is what keeps the mirror honest.
 *
 * Two rules shape the pool:
 *
 *  - A precondition the view cannot read is *attempted*, not excluded, so a
 *    move the engine would accept is never hidden. `first_card_this_round` is
 *    the one requirement check in that class: it reads the engine's private
 *    per-round play counter. A requirement entry that carries no `check` at
 *    all is unreadable in the same way and is attempted for the same reason.
 *    An equip a landmark's `prevent_equip` rule refuses is attempted too: the
 *    engine applies the rule in `LifecycleEngine.attachEquipment`, and the view
 *    ships a landmark's rules as display segments, so no check can be built
 *    from it.
 *  - Capacity is not a filter. A full line substitutes rather than refusing
 *    (RULES.md §Battlefield 6), so an overflowing deploy stays in the pool and
 *    the engine answers it with the `line_overflow` decision its controller
 *    resolves.
 */

import { KIND_LINES } from "../game/placement.js";

/**
 * The payload fields that identify one move, per action type, in a fixed order.
 * Every action type the projection can produce is listed; an unlisted type
 * falls back to its payload's own keys in sorted order, so a playstyle that
 * returns something unexpected still gets one stable identity.
 */
const MOVE_FIELDS = Object.freeze({
  "pass-turn-action": [],
  "generate-fire-charge-action": [],
  "deploy-unit-action": ["handId", "placedPositionCode"],
  "use-ability-action": ["unitId", "abilityCode"],
  "play-skill-action": ["handId"],
  "equip-equipment-action": ["handId", "targetUnitId"],
  "switch-position-action": ["unitId", "positionCode"],
});

/**
 * The single definition of move identity: the action type plus its payload
 * fields in the fixed order above. The controller's retry exclusion and the
 * tests both key on this, so "the same move" means one thing.
 *
 * A pending-decision resolution has no action type; it is identified by its
 * decision id and its chosen ids, because it is the other thing a playstyle
 * can be asked to retry. The chosen ids are sorted, so a re-ordered answer to
 * the same decision is the same move and cannot be offered twice: a decision
 * whose free candidates cannot satisfy its own minimum would otherwise be
 * retried once per permutation.
 *
 * @param {{ type: string, data: object } | { decisionId: string, choices: string[] }} move
 * @returns {string} a stable identity for the move
 */
export function moveKey(move) {
  if (!move || typeof move !== "object") return JSON.stringify(move ?? null);

  if (typeof move.decisionId === "string") {
    const choices = Array.isArray(move.choices) ? [...move.choices].sort() : [];
    return JSON.stringify(["decision", move.decisionId, ...choices]);
  }

  const type = move.type;
  const data = move.data ?? {};
  const fields = Object.hasOwn(MOVE_FIELDS, type) ? MOVE_FIELDS[type] : Object.keys(data).sort();
  return JSON.stringify([type ?? null, ...fields.map((field) => data[field] ?? null)]);
}

/**
 * Every move this seat could legally submit right now, computed from the view.
 *
 * @param {object} view the seat's redacted state view
 * @returns {Array<{ type: string, data: object }>} the move pool, pass first
 */
export function projectTurnOptions(view) {
  const you = view?.you;
  if (!you || typeof you !== "object") return [{ type: "pass-turn-action", data: {} }];

  const moves = [{ type: "pass-turn-action", data: {} }];
  if (!turnIsOpen(view, you)) return moves;

  const totalShinsu = shinsuTotal(you);
  const ownUnits = ownFieldUnits(you);
  const hand = Array.isArray(you.hand) ? you.hand : [];
  const deployedNames = new Set(ownUnits.map((unit) => unit.card?.name).filter(Boolean));

  if (canGenerateFireCharge(ownUnits, totalShinsu)) {
    moves.push({ type: "generate-fire-charge-action", data: {} });
  }

  for (const unit of ownUnits) moves.push(...abilityMoves(unit, you, ownUnits, totalShinsu));

  hand.forEach((card, handId) => {
    if (card?.type !== "skill" || !isAffordable(card, totalShinsu)) return;
    const context = { seat: you, ownUnits, unit: null, targetUnit: null };
    if (!requirementsMet(card.requirements, context)) return;
    moves.push({ type: "play-skill-action", data: { handId } });
  });

  hand.forEach((card, handId) => {
    if (card?.type !== "equipment" || !isAffordable(card, totalShinsu)) return;
    for (const unit of ownUnits) {
      const context = { seat: you, ownUnits, unit, targetUnit: unit };
      if (!requirementsMet(card.requirements, context)) continue;
      moves.push({ type: "equip-equipment-action", data: { handId, targetUnitId: unit.id } });
    }
  });

  for (const unit of ownUnits) moves.push(...switchMoves(unit, you));

  hand.forEach((card, handId) => {
    moves.push(...deployMoves(card, handId, totalShinsu, deployedNames));
  });

  return moves;
}

// ── The seat's own read of its turn ─────────────────────────────────────────

/**
 * Whether the engine would accept any action from this seat. The seat's own
 * turn is the only action-wide precondition; a view that omits `currentTurn`
 * is treated as the seat's own, because a view delivered to a seat is the
 * seat's own turn view.
 */
function turnIsOpen(view, you) {
  const currentTurn = view?.currentTurn;
  if (currentTurn === undefined || currentTurn === null) return true;
  return currentTurn === you.username;
}

/** Total spendable shinsu, exactly as `ShinsuService.getTotal` reads it. */
function shinsuTotal(you) {
  return (you.shinsu?.normalAvailable ?? 0) + (you.shinsu?.recharged ?? 0);
}

/** The seat's own living field units, frontline first. */
function ownFieldUnits(you) {
  const units = [...(you.field?.frontline ?? []), ...(you.field?.backline ?? [])];
  return units.filter((unit) => unit && (unit.currentHp ?? 1) > 0);
}

/** The engine-resolved cost, falling back to the printed cost. */
function cardCost(card) {
  return card?.effectiveCost ?? card?.cost ?? 0;
}

function isAffordable(card, totalShinsu) {
  return cardCost(card) <= totalShinsu;
}

// ── Fire charge ─────────────────────────────────────────────────────────────

/**
 * The Hwayeomsa core ability's preconditions: a Hwayeomsa on the field and 1
 * spendable shinsu. Only a printed attribute counts — the engine's check reads
 * the card's own attribute list, not the modifier stack.
 */
function canGenerateFireCharge(ownUnits, totalShinsu) {
  if (totalShinsu < 1) return false;
  return ownUnits.some((unit) => Object.hasOwn(unit.card?.attributes ?? {}, "hwayeomsa"));
}

// ── Abilities ───────────────────────────────────────────────────────────────

/** One `use-ability-action` per printed ability and per granted ability. */
function abilityMoves(unit, you, ownUnits, totalShinsu) {
  const moves = [];
  const printed = Array.isArray(unit.card?.abilities) ? unit.card.abilities : [];

  printed.forEach((ability, index) => {
    const abilityCode = String(index);
    if (!canUseAbility(unit, ability, you, ownUnits, totalShinsu)) return;
    moves.push({ type: "use-ability-action", data: { unitId: unit.id, abilityCode } });
  });

  for (const granted of unit.grantedAbilities ?? []) {
    if (typeof granted?.abilityCode !== "string") continue;
    if (!canUseAbility(unit, granted.ability, you, ownUnits, totalShinsu)) continue;
    moves.push({ type: "use-ability-action", data: { unitId: unit.id, abilityCode: granted.abilityCode } });
  }

  return moves;
}

/**
 * Mirror `UseAbilityAction.validate`: the ability's position, not being
 * Stunned, Free (from the node or the unit's projected keywords) or a
 * spendable combat slot, its cost, and its own requirements.
 */
function canUseAbility(unit, ability, you, ownUnits, totalShinsu) {
  if (!ability || typeof ability !== "object") return false;

  if (ability.position && ability.position !== unit.placedPositionCode) return false;
  if (hasCondition(unit, "stunned")) return false;

  const free = ability.free === true || (unit.keywords ?? []).includes("free");
  if (!free && !combatSlotAvailable(unit, you)) return false;

  const baseCost = ability.type === "spend_shinsu" && typeof ability.amount === "number" ? ability.amount : 0;
  if (baseCost + conditionMagnitude(unit, "heavy") > totalShinsu) return false;

  return requirementsMet(ability.requirements, { seat: you, ownUnits, unit, targetUnit: null });
}

/**
 * A non-Free ability spends the Shinheuh slot on a shinheuh and the position's
 * combat slot on anything else. A unit with no position (a landmark) has no
 * combat slot to spend, exactly as the engine's own lookup finds none.
 */
function combatSlotAvailable(unit, you) {
  if ((unit.card?.kind ?? "standard") === "shinheuh") return you.shinheuhSlot?.available === true;
  return positionSlotAvailable(you, unit.placedPositionCode);
}

/**
 * A position's combat slot as the seat view carries it. A slot the view omits
 * reads as available, exactly as `CombatSlotService.isAvailable` reads a slot
 * the state does not carry.
 */
function positionSlotAvailable(you, positionCode) {
  const slot = you.combatSlots?.[positionCode];
  return !slot || slot.available !== false;
}

function hasCondition(unit, key) {
  return (unit.conditions ?? []).some((condition) => condition?.key === key);
}

/** A condition's effective magnitude, or 0 when the unit does not carry it. */
function conditionMagnitude(unit, key) {
  const condition = (unit.conditions ?? []).find((entry) => entry?.key === key);
  return typeof condition?.magnitude === "number" ? condition.magnitude : 0;
}

// ── Position switches ───────────────────────────────────────────────────────

/**
 * One `switch-position-action` per other position the unit prints.
 *
 * A switch spends the combat slot of the position it leaves, and a spent
 * departure slot admits no switch (RULES.md §Combat Slots 6). The destination's
 * slot is deliberately not read: arriving in a spent position is legal, so a
 * spent destination never removes a move from the pool.
 */
function switchMoves(unit, you) {
  if (hasCondition(unit, "rooted")) return [];
  if (!positionSlotAvailable(you, unit.placedPositionCode)) return [];
  return Object.keys(unit.card?.positions ?? {})
    .filter((positionCode) => positionCode !== unit.placedPositionCode)
    .map((positionCode) => ({ type: "switch-position-action", data: { unitId: unit.id, positionCode } }));
}

// ── Deploys ─────────────────────────────────────────────────────────────────

/**
 * One `deploy-unit-action` per position a standard unit prints, or one for a
 * non-standard unit, whose position code is its kind's placement slot. A
 * same-name unit already on the seat's board is the engine's own refusal, and
 * a full line deliberately stays in the pool.
 */
function deployMoves(card, handId, totalShinsu, deployedNames) {
  if (card?.type !== "unit") return [];
  if (deployedNames.has(card.name)) return [];
  if (!isAffordable(card, totalShinsu)) return [];

  const positionCodes =
    (card.kind ?? "standard") === "standard"
      ? Object.keys(card.positions ?? {})
      : [nonStandardSlotCode(card)].filter(Boolean);

  return positionCodes.map((placedPositionCode) => ({
    type: "deploy-unit-action",
    data: { handId, placedPositionCode },
  }));
}

/**
 * The position code a non-standard deploy sends: the placement slot whose
 * accepted lines the card's `deployLines` match. That slot's code is the kind
 * code (`buildPlacementRegistry` composes one kind slot per line), and the
 * code is symbolic — the resolved line decides the destination, and the engine
 * ignores the code for every non-standard kind. A kind the registry offers no
 * slot for (the Conduit) has no deploy move.
 */
function nonStandardSlotCode(card) {
  const rule = Object.hasOwn(KIND_LINES, card.kind) ? KIND_LINES[card.kind] : null;
  if (!rule?.slot) return null;
  const lines = Array.isArray(card.deployLines) ? card.deployLines : [];
  return rule.lines.some((line) => lines.includes(line)) ? card.kind : null;
}

// ── Requirements ────────────────────────────────────────────────────────────

/**
 * The compiled check an entry carries. A card view's requirement entry wraps
 * the compiled node as `{ text, check }`; an ability node carries the compiled
 * node itself (it is the DSL the engine validates). Anything else is not a
 * readable check, and the caller attempts its move.
 */
function requirementCheck(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  if (entry.check && typeof entry.check === "object" && typeof entry.check.type === "string") return entry.check;
  if (typeof entry.type === "string") return entry;
  return null;
}

/**
 * Whether every readable requirement is satisfied. An unreadable entry is
 * attempted; `first_card_this_round` reads the engine's private per-round play
 * counter, so it is attempted too. An unknown check type is a projection that
 * no longer mirrors the validator's closed set: it throws rather than silently
 * deciding either way.
 */
function requirementsMet(requirements, context) {
  for (const entry of requirements ?? []) {
    const check = requirementCheck(entry);
    if (!check) continue;
    if (check.type === "first_card_this_round") continue;

    const evaluate = REQUIREMENT_CHECKS[check.type];
    if (!evaluate) {
      throw new Error(
        `Unsupported requirement type: "${check.type}". Implement it in RequirementValidator and mirror it in server/bots/turnOptions.js.`
      );
    }
    if (!evaluate(check, context)) return false;
  }
  return true;
}

/**
 * The six requirement checks `server/game/services/RequirementValidator.js`
 * owns, evaluated against the view. Each answers "is this check satisfied",
 * with the engine's own reading of an unreadable target: a check that would
 * throw there is unsatisfied here, because the engine will refuse the move.
 */
const REQUIREMENT_CHECKS = Object.freeze({
  /** The source unit itself must occupy the named position. */
  deployed_as(check, { unit }) {
    return Boolean(unit) && unit.placedPositionCode === check.position;
  },

  /**
   * A target's side. With a target (equipment) the side is checked against the
   * source's owner; without one (a skill or an ability, which chooses its
   * target after the play) an ally requires a legal allied unit on the board,
   * and an enemy has no target to check.
   *
   * The enemy branch therefore admits nothing from this pool, and that is the
   * engine's own reading rather than a stricter local rule: the validator
   * refuses `side: "enemy"` whenever no target unit reached it, which is every
   * skill play (no `sourceUnit`, no `targetUnit`) and every ability use (the
   * unit itself is the source, and the target is still unresolvable). No
   * shipped card names `side: "enemy"`; the branch is the mirror that keeps a
   * future one from being offered and refused.
   */
  target_side(check, { unit, targetUnit, ownUnits }) {
    if (check.side === "enemy") {
      if (!targetUnit || !unit) return false;
      return targetUnit.owner !== unit.owner;
    }
    if (!targetUnit) return ownUnits.length > 0;
    return targetUnit.owner === (unit?.owner ?? targetUnit.owner);
  },

  /** The source unit (an equipment's bearer) must carry the code. */
  bearer_has(check, { unit }) {
    if (!unit) return false;
    const hasAffiliation = Boolean(check.affiliation) && carriesAffiliation(unit, check.affiliation);
    const hasAttribute = Boolean(check.attribute) && carriesAttribute(unit, check.attribute);
    return hasAffiliation || hasAttribute;
  },

  /** A same-named unit must be deployed on the seat's own board. */
  unit_on_board(check, { ownUnits }) {
    if (typeof check.name !== "string") return false;
    const name = check.name.toLowerCase();
    return ownUnits.some((unit) => unit.card?.name?.toLowerCase() === name);
  },

  /** An allied unit on the board must carry the code. */
  has_ally(check, { ownUnits }) {
    const hasAffiliation = Boolean(check.affiliation) && ownUnits.some((unit) => carriesAffiliation(unit, check.affiliation));
    const hasAttribute = Boolean(check.attribute) && ownUnits.some((unit) => carriesAttribute(unit, check.attribute));
    return hasAffiliation || hasAttribute;
  },
});

/** A unit's affiliation: the code its card prints, or one the stack granted. */
function carriesAffiliation(unit, code) {
  const printed = unit.card?.affiliations;
  const printedCodes = Array.isArray(printed) ? printed : Object.keys(printed ?? {});
  if (printedCodes.includes(code)) return true;
  return (unit.runtimeAffiliations ?? []).some((entry) => entry?.key === code);
}

/** A unit's attribute: the code its card prints, or one the stack granted. */
function carriesAttribute(unit, code) {
  const printed = unit.card?.attributes;
  const printedCodes = Array.isArray(printed) ? printed : Object.keys(printed ?? {});
  if (printedCodes.includes(code)) return true;
  return (unit.runtimeAttributes ?? []).some((entry) => entry?.key === code);
}
