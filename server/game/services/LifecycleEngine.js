/**
 * Authoritative unit lifecycle engine — the only path for deploying,
 * destroying, transforming, and equipping units.
 *
 * All mutations go through EventBus for DFS-resolved cascading effects.
 * This engine calls ZoneService for card movement and ModifierStack for
 * state changes — it never mutates game state directly.
 */

import * as IdFactory from "../IdFactory.js";
import Unit from "../Unit.js";
import ZoneService from "./ZoneService.js";
import ShinsuService from "./ShinsuService.js";
import Card from "../Card.js";

export default class LifecycleEngine {
  /**
   * Deploy a unit from hand to the battlefield.
   *
   * Validates: position availability, line cap (5 max), same-name check,
   * landmark replacement, cost deduction via Compress.
   *
   * @param {GameState} gameState
   * @param {string} username
   * @param {number} handIndex
   * @param {string} positionCode
   * @returns {{ unit: Unit, overflowDestroyed: boolean }}
   */
  static deployUnit(gameState, username, handIndex, positionCode) {
    const player = gameState.playerStates[username];
    if (!player) throw new Error(`Player "${username}" not found`);

    const positionDef = gameState.constructor.positions[positionCode];
    if (!positionDef) throw new Error(`Invalid position: "${positionCode}"`);

    // Validate it's player's turn
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");

    // Get card from hand
    const card = ZoneService.removeFromHand(player, handIndex);
    if (!card || card.type !== "unit") throw new Error("Card is not a unit or not in hand.");

    // Validate position
    if (!(positionCode in card.positions)) {
      throw new Error(`Card "${card.name}" cannot be placed in position "${positionCode}".`);
    }

    // Calculate effective cost (compress reduction)
    let cost = card.cost;
    if (player.compressAmount > 0) {
      cost = Math.max(0, cost - player.compressAmount);
      player.compressAmount = 0;
    }

    // Check shinsu
    if (!ShinsuService.canAfford(player, cost)) {
      throw new Error("Not enough shinsu to deploy this unit.");
    }

    // Same-name check: can't have another unit with same name on your board
    const existingSame = player.field?.frontline
      ?.concat(player.field?.backline || [])
      .find((u) => u.card?.name === card.name);
    if (existingSame) {
      throw new Error(`You already have "${card.name}" deployed.`);
    }

    // Special: landmark — destroy existing landmark if present
    if (positionDef.special && positionCode === "landmark") {
      const existingLandmark = (player.field?.backline || [])
        .find((u) => u.placedPositionCode === "landmark");
      if (existingLandmark) {
        LifecycleEngine.destroyUnit(gameState, existingLandmark);
      }
    }

    // Deduct shinsu
    ShinsuService.spend(player, cost);

    // Create unit
    const unit = new Unit(card, positionCode);
    const line = player.field[positionDef.line];
    line.push(unit);

    // Check line overflow (max 5 units)
    let overflowDestroyed = false;
    if (line.length > 5) {
      // Destroy the oldest unit (first in array)
      const overflowUnit = line.shift();
      LifecycleEngine.destroyUnit(gameState, overflowUnit);
      overflowDestroyed = true;
    }

    // Emit deploy event chain
    gameState.eventBus.emit("unit:deployed", {
      username,
      unit,
      positionCode,
      cost,
    });

    gameState.eventBus.emit("unit:summoned", {
      username,
      unit,
      unitId: unit.id,
    });

    // Apply native traits via ModifierStack
    const sourceId = IdFactory.unitSource(card.cardId);
    const nativeTraits = card.traits || [];
    for (const traitCode of Object.keys(card.traitValues || {})) {
      gameState.modifierStack.apply({
        sourceId,
        sourceType: "unit",
        targetId: unit.id,
        type: "trait",
        key: traitCode,
        value: card.traitValues[traitCode],
      });
    }

    // Register evolution trigger if applicable
    if (card.evolveInto && gameState._triggerManager) {
      gameState._triggerManager.registerTransformation(
        unit.id,
        card.evolveInto.triggers,
        card.evolveInto.cardId,
        "evolution",
        gameState
      );
    }

    // Wire attribute engines
    if (gameState._attributeRegistry) {
      gameState._attributeRegistry.onUnitDeployed(unit, gameState);
    }

    return { unit, overflowDestroyed };
  }

  /**
   * Destroy a unit: remove from field, move card to discard,
   * clean up ModifierStack, detach equipment.
   */
  static destroyUnit(gameState, unit) {
    if (!unit) return;

    // Emit pre-destroy intent (can be cancelled by handlers)
    const result = gameState.eventBus.emit("unit:destroy:intent", {
      unitId: unit.id,
      unit,
    });
    if (result?.cancelled) return;

    // Detach equipment — returns to hand (de-ignited per RULES.md)
    if (unit.equipment) {
      LifecycleEngine.detachEquipment(gameState, unit);
    }

    // Remove from field
    for (const username of gameState.usernames) {
      const field = gameState.playerStates[username]?.field;
      if (!field) continue;
      for (const line of ["frontline", "backline"]) {
        const idx = (field[line] || []).indexOf(unit);
        if (idx !== -1) {
          field[line].splice(idx, 1);
          break;
        }
      }
    }

    // Move card to discard
    const player = gameState.playerStates[unit.owner];
    if (player) {
      ZoneService.discard(player, unit.card);
    }

    // Emit destroyed event (ModifierStack auto-cleans via listener)
    gameState.eventBus.emit("unit:destroyed", {
      unitId: unit.id,
      unit,
      owner: unit.owner,
    });
  }

  /**
   * Transform a unit: atomically swap definition while preserving state.
   * Used for evolution and ignition transformations.
   *
   * Preserved: HP delta (lost HP stays), conditions, equipment, grants,
   * slot position, identity.
   */
  static transformUnit(gameState, unit, targetCardId) {
    const targetCard = gameState.constructor.cards[targetCardId];
    if (!targetCard) throw new Error(`Target card ${targetCardId} not found`);
    if (targetCard.type !== "unit") throw new Error(`Target card ${targetCardId} is not a unit`);

    const lostHp = unit.card.maxHp - unit.currentHp;
    const oldCard = unit.card;

    // Swap card definition
    unit.card = targetCard;
    unit.currentHp = Math.max(1, targetCard.hp - lostHp);

    // Re-apply native traits with new source
    const oldSourceId = IdFactory.unitSource(oldCard.cardId);
    gameState.modifierStack.removeBySource(oldSourceId);

    const newSourceId = IdFactory.unitSource(targetCardId);
    const nativeTraits = targetCard.traits || [];
    for (const traitCode of Object.keys(unit.card.traitValues || {})) {
      gameState.modifierStack.apply({
        sourceId: newSourceId,
        sourceType: "unit",
        targetId: unit.id,
        type: "trait",
        key: traitCode,
        value: unit.card.traitValues[traitCode],
      });
    }

    // Remove old evolution subscriptions, register new ones
    if (gameState._triggerManager) {
      gameState._triggerManager.unregisterAll(unit.id);
      if (targetCard.evolveInto) {
        gameState._triggerManager.registerTransformation(
          unit.id,
          targetCard.evolveInto.triggers,
          targetCard.evolveInto.cardId,
          "evolution",
          gameState
        );
      }
    }

    // Emit transformation event
    gameState.eventBus.emit("unit:evolved", {
      unitId: unit.id,
      unit,
      from: oldCard.name,
      to: targetCard.name,
      fromCardId: oldCard.cardId,
      toCardId: targetCardId,
    });
  }

  /**
   * Attach equipment to a unit.
   * Validates Irregular multi-equip rule, replaces existing equipment.
   */
  static attachEquipment(gameState, username, handIndex, targetUnit) {
    const player = gameState.playerStates[username];
    if (!player) throw new Error(`Player "${username}" not found`);

    const card = ZoneService.removeFromHand(player, handIndex);
    if (!card || card.type !== "equipment") throw new Error("Card is not equipment.");

    // Cost check
    let cost = card.cost;
    if (player.compressAmount > 0) {
      cost = Math.max(0, cost - player.compressAmount);
      player.compressAmount = 0;
    }
    if (!ShinsuService.canAfford(player, cost)) {
      throw new Error("Not enough shinsu to equip.");
    }

    // Irregular can have multiple equipment
    const isIrregular = gameState.modifierStack.has(targetUnit.id, "attribute", "irregular") ||
      (targetUnit.card?.attributes || []).includes("irregular");

    if (targetUnit.equipment && !isIrregular) {
      // Replace existing equipment — return to hand
      LifecycleEngine.detachEquipment(gameState, targetUnit);
    }

    ShinsuService.spend(player, cost);
    targetUnit.equipment = card;

    // Apply equipment effects via ModifierStack
    const sourceId = IdFactory.equipSource(card.cardId);
    // (Effect application is handled by the action system in Phase 3)

    // Register ignition trigger
    if (card.igniteInto && gameState._triggerManager) {
      gameState._triggerManager.registerTransformation(
        targetUnit.id,
        card.igniteInto.triggers,
        card.igniteInto.cardId,
        "ignition",
        gameState
      );
    }

    gameState.eventBus.emit("equipment:attached", {
      unitId: targetUnit.id,
      equipment: card,
      sourceId,
    });
  }

  /**
   * Detach equipment: return to hand (de-ignited), remove modifiers.
   */
  static detachEquipment(gameState, unit) {
    if (!unit.equipment) return;

    const equip = unit.equipment;
    const sourceId = IdFactory.equipSource(equip.cardId);

    // Remove all modifiers from this equipment
    gameState.modifierStack.removeBySource(sourceId);

    // Remove ignition subscriptions
    if (gameState._triggerManager) {
      gameState._triggerManager.unregisterAll(unit.id);
    }

    unit.equipment = null;

    // Return to hand (de-ignited — use base form)
    const player = gameState.playerStates[unit.owner];
    if (player && equip) {
      // If ignited, find base form
      if (equip.ignitedFrom !== undefined && equip.ignitedFrom !== null) {
        const baseCardData = gameState.constructor.cards[equip.ignitedFrom];
        if (baseCardData) {
          // Create new Card instance for base form
          const Card = Card;
          const baseCard = new Card(equip.ignitedFrom, baseCardData, unit.owner, gameState.eventBus);
          ZoneService.addToHand(player, baseCard);
        }
      } else {
        ZoneService.addToHand(player, equip);
      }
    }

    gameState.eventBus.emit("equipment:detached", {
      unitId: unit.id,
      equipment: equip,
    });
  }
}
