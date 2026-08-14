/**
 * Deterministic ID factory for all game entities.
 *
 * Replaces ad-hoc Math.random() IDs with stable, debuggable identifiers.
 * Every ID follows the convention: <prefix>#<unique>
 *
 * Source IDs for ModifierStack:
 *   Unit#<cardId>       — unit's native traits
 *   Equip#<cardId>      — equipment-granted modifiers
 *   Ability#<unitId>#<idx>   — activated ability
 *   Passive#<unitId>#<idx>   — passive ability
 *   Skill#<cardId>      — skill one-shot effects
 *   Landmark#<unitId>   — landmark passive
 *   System               — game rules (shinsu reset, etc.)
 *
 * Instance IDs for game objects:
 *   Card#<cardId>#<seq>  — card instance in hand/deck/discard
 *   Unit#<cardId>#<seq>  — unit instance on battlefield
 */

let _cardInstanceSeq = 0;
let _unitInstanceSeq = 0;
let _modifierSeq = 0;
let _decisionSeq = 0;

let _resetModCounter = null;

/** Register a hook to reset the ModifierStack counter for deterministic replays. */
export function registerModifierReset(fn) {
  _resetModCounter = fn;
}

export function resetAll() {
  _cardInstanceSeq = 0;
  _unitInstanceSeq = 0;
  _modifierSeq = 0;
  _decisionSeq = 0;
  if (_resetModCounter) _resetModCounter();
}

/**
 * Snapshot the module-level ID counters for deterministic serialization.
 * @returns {{ cardInstanceSeq: number, unitInstanceSeq: number, modifierSeq: number, decisionSeq: number }}
 */
export function getCounters() {
  return {
    cardInstanceSeq: _cardInstanceSeq,
    unitInstanceSeq: _unitInstanceSeq,
    modifierSeq: _modifierSeq,
    decisionSeq: _decisionSeq,
  };
}

/**
 * Restore the module-level ID counters (used by replay).
 * @param {{ cardInstanceSeq?: number, unitInstanceSeq?: number, modifierSeq?: number, decisionSeq?: number }} counters
 */
export function setCounters(counters) {
  if (!counters) return;
  _cardInstanceSeq = counters.cardInstanceSeq ?? 0;
  _unitInstanceSeq = counters.unitInstanceSeq ?? 0;
  _modifierSeq = counters.modifierSeq ?? 0;
  _decisionSeq = counters.decisionSeq ?? 0;
}

// ── Source IDs (ModifierStack) ──────────────────────────────────────────────

export function unitSource(cardId) {
  return `Unit#${cardId}`;
}

export function equipSource(cardId) {
  return `Equip#${cardId}`;
}

export function abilitySource(unitId, index) {
  return `Ability#${unitId}#${index}`;
}

export function passiveSource(unitId, index) {
  return `Passive#${unitId}#${index}`;
}

export function skillSource(cardId) {
  return `Skill#${cardId}`;
}

export function landmarkSource(unitId) {
  return `Landmark#${unitId}`;
}

export function systemSource() {
  return "System";
}

// ── Instance IDs ────────────────────────────────────────────────────────────

export function cardInstance(cardId) {
  return `Card#${cardId}#${++_cardInstanceSeq}`;
}

export function unitInstance(cardId) {
  return `Unit#${cardId}#${++_unitInstanceSeq}`;
}

// ── Modifier IDs ────────────────────────────────────────────────────────────

export function modifierId() {
  return `mod_${++_modifierSeq}`;
}

export function decisionId() {
  return `decision#${++_decisionSeq}`;
}

/**
 * Create a code for a granted ability.
 * Format: granted:<sourceId>:<abilityType>
 *
 * Example: "granted:Equip#17:deal_damage"
 */
export function grantedAbilityCode(sourceId, ability) {
  const type = ability?.type || "custom";
  return `granted:${sourceId}:${type}`;
}

export default {
  resetAll,
  getCounters,
  setCounters,
  unitSource,
  equipSource,
  abilitySource,
  passiveSource,
  skillSource,
  landmarkSource,
  systemSource,
  cardInstance,
  unitInstance,
  modifierId,
  decisionId,
};
