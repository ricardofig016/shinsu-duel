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

export function resetAll() {
  _cardInstanceSeq = 0;
  _unitInstanceSeq = 0;
  _modifierSeq = 0;
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

export default {
  resetAll,
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
};
