import ActionHandler from "../ActionHandler.js";
import RequirementValidator from "../services/RequirementValidator.js";
import ShinsuService from "../services/ShinsuService.js";
import CombatSlotService from "../services/CombatSlotService.js";
import EVT from "../EventCatalog.js";
import { resolveEffect } from "../EffectResolver.js";

/**
 * Use a unit's compiled DSL ability.
 */
export default class UseAbilityAction extends ActionHandler {
  static schema = {
    source: "string",
    username: "string",
    unitId: "string",
    abilityCode: "string",
  };
  static sourceAccess = { player: true, system: false };

  /**
   * Resolve an abilityCode into its DSL and provenance.
   *
   * Native abilities are addressed by numeric index into `card.abilities`.
   * Abilities granted at runtime (e.g. by equipment via `grant_ability`) are
   * resolved through the authoritative AbilityRegistry.
   */
  static resolveAbility(gameState, unit, abilityCode) {
    if (typeof abilityCode === "string" && abilityCode.startsWith("granted:")) {
      return gameState._abilityRegistry.resolve(unit.id, abilityCode);
    }

    const abilityIndex = Number(abilityCode);
    const ability = unit.card.abilities?.[abilityIndex];
    if (!Number.isInteger(abilityIndex) || !ability) return null;
    return { ability, sourceType: "unit", sourceId: unit.id };
  }

  validate(data, gameState) {
    super.validate(data);
    const { username, unitId, abilityCode } = data;
    const playerState = gameState.playerStates[username];

    if (!playerState) throw new Error(`Player ${username} not found.`);
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");

    const unit = [...playerState.field.frontline, ...playerState.field.backline].find((u) => u.id === unitId);
    if (!unit) throw new Error(`Unit ${unitId} not found in your field.`);

    const resolved = UseAbilityAction.resolveAbility(gameState, unit, abilityCode);
    if (!resolved) throw new Error("Invalid abilityCode.");
    const { ability } = resolved;
    if (ability.position && ability.position !== unit.placedPositionCode) {
      throw new Error(`Ability requires the ${ability.position} position.`);
    }
    if (gameState.modifierStack.has(unit.id, "condition", "stunned")) {
      throw new Error("A Stunned unit cannot use abilities.");
    }

    const isShinheuh = Boolean(unit.card.positions?.["frontline-shinheuh"] || unit.card.positions?.["backline-shinheuh"]);
    if (isShinheuh) {
      if (!CombatSlotService.isShinheuhSlotAvailable(playerState)) throw new Error("Shinheuh combat slot is unavailable.");
    } else if (!ability.free) {
      const slot = playerState.combatSlots?.[unit.placedPositionCode];
      if (slot && !slot.available) throw new Error(`Combat slot for ${unit.placedPositionCode} is already used this round.`);
    }

    const baseCost = ability.type === "spend_shinsu" ? ability.amount : 0;
    const heavy = gameState.modifierStack.getEffective(unit.id, "condition", "heavy");
    const abilityCost = baseCost + heavy;
    if (!ShinsuService.canAfford(playerState, abilityCost)) throw new Error("Not enough shinsu to use this ability.");
    RequirementValidator.validate(ability.requirements, { gameState, username, sourceUnit: unit, card: unit.card });
    return true;
  }

  execute(data, gameState) {
    const { username, unitId, abilityCode } = data;
    const playerState = gameState.playerStates[username];
    const unit = gameState._findUnit(unitId);
    const { ability } = UseAbilityAction.resolveAbility(gameState, unit, abilityCode);

    const isShinheuh = Boolean(unit.card.positions?.["frontline-shinheuh"] || unit.card.positions?.["backline-shinheuh"]);
    if (isShinheuh) {
      CombatSlotService.consumeShinheuhSlot(playerState);
    } else if (!ability.free) {
      CombatSlotService.consume(playerState, unit.placedPositionCode);
    }

    const baseCost = ability.type === "spend_shinsu" ? ability.amount : 0;
    const heavy = gameState.modifierStack.getEffective(unit.id, "condition", "heavy");
    if (heavy > 0) ShinsuService.spend(playerState, heavy);
    const poison = gameState.modifierStack.getEffective(unit.id, "condition", "poisoned");
    const context = { emitChild: (eventName, payload) => gameState.eventBus.emit(eventName, payload) };
    resolveEffect(ability, context, gameState, {
      owner: username,
      sourceId: unit.id,
      sourceUnit: unit,
      sourceOwner: username,
      targetOwner: gameState.usernames.find((candidate) => candidate !== username),
    });
    gameState.completeActionAfterDecision(() => {
      gameState.eventBus.emit(EVT.UNIT_ABILITY_USED, { username, unitId, abilityCode });
      if (poison > 0 && unit.isAlive()) {
        const poisonContext = { emitChild: (eventName, payload) => gameState.eventBus.emit(eventName, payload) };
        resolveEffect({ type: "deal_damage", amount: poison, targetId: unit.id, raw: "Poisoned" }, poisonContext, gameState, {
          sourceId: unit.id,
          sourceUnit: unit,
          sourceOwner: username,
          targetOwner: username,
        });
      }
      if (!ability.quick) gameState.endTurn();
    });
  }
}
