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
import { resolveEffects } from "../EffectResolver.js";

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
  static deployUnit(gameState, username, handIndex, positionCode, options = {}) {
    const player = gameState.playerStates[username];
    if (!player) throw new Error(`Player "${username}" not found`);

    const positionDef = gameState.constructor.positions[positionCode];
    if (!positionDef) throw new Error(`Invalid position: "${positionCode}"`);

    // Validate it's player's turn
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");

    // Read first: service callers must never lose a card because a later
    // lifecycle validation fails.
    const card = player.hand?.[handIndex];
    if (!card || card.type !== "unit") throw new Error("Card is not a unit or not in hand.");

    // Validate position
    if (!(positionCode in card.positions)) {
      throw new Error(`Card "${card.name}" cannot be placed in position "${positionCode}".`);
    }

    // Compression is a reduction on this card instance. It remains attached to this card until it is played.
    const cost = Math.max(0, card.cost - (card.costReduction || 0));

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

    // Mutate only after every synchronous validation above has succeeded.
    ZoneService.removeFromHand(player, handIndex);
    ShinsuService.spend(player, cost);

    // Create unit
    const unit = new Unit(card, positionCode);
    const line = player.field[positionDef.line];
    line.push(unit);

    // Check line overflow (max 5 units). The owner chooses one of the six
    // units, including the new deployment, to destroy before play continues.
    let overflowDestroyed = false;
    if (line.length > 5) {
      const candidates = line.map((candidate) => ({
        id: candidate.id,
        name: candidate.card.name,
        hp: candidate.currentHp,
      }));
      gameState.createPendingDecision({
        owner: username,
        type: "line_overflow",
        candidates,
        resolve: ([unitId]) => {
          const overflowUnit = gameState._findUnit(unitId);
          if (overflowUnit) LifecycleEngine.destroyUnit(gameState, overflowUnit);
        },
      });
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
    const sourceId = IdFactory.unitSource(unit.id);
    // `Card.traits` is a dictionary keyed by canonical trait code. Apply both
    // valueless traits (Barrier, Taunt, Immune, ...) and numeric traits.
    for (const traitCode of Object.keys(card.traits || {})) {
      gameState.modifierStack.apply({
        sourceId,
        sourceType: "unit",
        targetId: unit.id,
        type: "trait",
        key: traitCode,
        value: card.traitValues?.[traitCode] ?? 1,
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

    gameState._triggerManager?.unregisterAll(unit.id);
    gameState._attributeRegistry?.onUnitRemoved(unit, gameState);

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

    // Swap card definition while preserving damage. A transformation may enter
    // with 0 HP only when the caller already allowed a lethal state.
    unit.card = new Card(targetCardId, targetCard, unit.owner, gameState.eventBus);
    unit.currentHp = Math.max(0, unit.card.maxHp - lostHp);

    // Re-apply native traits with new source
    const sourceId = IdFactory.unitSource(unit.id);
    gameState.modifierStack.removeBySource(sourceId);

    for (const traitCode of Object.keys(unit.card.traits || {})) {
      gameState.modifierStack.apply({
        sourceId,
        sourceType: "unit",
        targetId: unit.id,
        type: "trait",
        key: traitCode,
        value: unit.card.traitValues?.[traitCode] ?? 1,
      });
    }

    // Replace only evolution subscriptions; equipment ignition subscriptions
    // remain attached to the bearer across a unit evolution.
    if (gameState._triggerManager) {
      gameState._triggerManager.unregisterAll(unit.id, "evolution");
      if (unit.card.evolveInto) {
        gameState._triggerManager.registerTransformation(
          unit.id,
          unit.card.evolveInto.triggers,
          unit.card.evolveInto.cardId,
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

  /** Transform an attached equipment card into its ignited definition. */
  static transformEquipment(gameState, unit, targetCardId, equipmentId = null) {
    const targetCard = gameState.constructor.cards[targetCardId];
    const attachments = LifecycleEngine._getEquipment(unit);
    const attachmentIndex = equipmentId
      ? attachments.findIndex((entry) => entry.id === equipmentId)
      : 0;
    if (attachmentIndex < 0) throw new Error("Cannot ignite equipment that is not attached.");
    if (!targetCard || targetCard.type !== "equipment") {
      throw new Error(`Target card ${targetCardId} is not equipment`);
    }

    const oldEquipment = attachments[attachmentIndex];
    gameState.modifierStack.removeBySource(oldEquipment.id);
    const ignited = new Card(targetCardId, targetCard, unit.owner, gameState.eventBus);
    attachments[attachmentIndex] = ignited;
    LifecycleEngine._syncEquipment(unit, attachments);
    LifecycleEngine._resolveEquipmentEffects(gameState, unit, ignited);
    gameState.eventBus.emit("equipment:ignited", {
      unitId: unit.id,
      equipment: ignited,
      fromCardId: oldEquipment.cardId,
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

    // As with deployment, read before mutating the hand so direct service
    // use remains transactional when validation fails.
    const card = player.hand?.[handIndex];
    if (!card || card.type !== "equipment") throw new Error("Card is not equipment.");

    const cost = Math.max(0, card.cost - (card.costReduction || 0));
    if (!ShinsuService.canAfford(player, cost)) {
      throw new Error("Not enough shinsu to equip.");
    }

    // Irregulars may retain several unique equipment instances. Store every
    // attachment in one canonical list; `equipment` remains a compatibility
    // alias for callers and the client projection.
    const isIrregular = gameState.modifierStack.has(targetUnit.id, "attribute", "irregular") ||
      (targetUnit.card?.attributes || []).includes("irregular");
    const attachments = LifecycleEngine._getEquipment(targetUnit);

    if (attachments.length > 0 && !isIrregular) {
      // A normal bearer replaces its existing equipment.
      LifecycleEngine.detachEquipment(gameState, targetUnit, attachments[0]);
    }
    if (isIrregular && attachments.some((attached) => attached.cardId === card.cardId)) {
      throw new Error("An Irregular can only equip unique equipment cards.");
    }

    ZoneService.removeFromHand(player, handIndex);
    ShinsuService.spend(player, cost);
    const updatedAttachments = LifecycleEngine._getEquipment(targetUnit);
    updatedAttachments.push(card);
    LifecycleEngine._syncEquipment(targetUnit, updatedAttachments);

    // Effects are resolved immediately and retain card-instance provenance so
    // replacing one copy cannot revoke another copy's modifiers.
    const sourceId = card.id;
    LifecycleEngine._resolveEquipmentEffects(gameState, targetUnit, card);

    // Register ignition trigger
    if (card.igniteInto && gameState._triggerManager) {
      gameState._triggerManager.registerTransformation(
        targetUnit.id,
        card.igniteInto.triggers,
        card.igniteInto.cardId,
        "ignition",
        gameState,
        card.id
      );
    }

    gameState.eventBus.emit("equipment:attached", {
      unitId: targetUnit.id,
      equipment: card,
      sourceId,
    });
  }

  /**
   * Detach one equipment card, or every attachment when no card is specified.
   * Detached ignited cards return as fresh base-form instances.
   */
  static detachEquipment(gameState, unit, equipment = null) {
    const attachments = LifecycleEngine._getEquipment(unit);
    const toDetach = equipment ? attachments.filter((entry) => entry === equipment) : attachments;
    if (toDetach.length === 0) return;

    const player = gameState.playerStates[unit.owner];
    for (const equip of toDetach) {
      gameState.modifierStack.removeBySource(equip.id);
      gameState._triggerManager?.unregisterAll(unit.id, "ignition", equip.id);

      if (player) {
        if (equip.ignitedFrom !== undefined && equip.ignitedFrom !== null) {
          const baseCardData = gameState.constructor.cards[equip.ignitedFrom];
          if (baseCardData) {
            ZoneService.addToHand(player, new Card(equip.ignitedFrom, baseCardData, unit.owner, gameState.eventBus));
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

    LifecycleEngine._syncEquipment(unit, attachments.filter((entry) => !toDetach.includes(entry)));
  }

  static _getEquipment(unit) {
    if (Array.isArray(unit.equipmentAttachments)) return unit.equipmentAttachments;
    return unit.equipment ? [unit.equipment] : [];
  }

  static _syncEquipment(unit, equipment) {
    unit.equipmentAttachments = equipment;
    // Keep the historic single-card property stable for existing callers and
    // clients while Irregular-only consumers read equipmentAttachments.
    unit.equipment = equipment[0] || null;
  }

  static _resolveEquipmentEffects(gameState, unit, equipment) {
    const context = {
      emitChild: (eventName, payload) => gameState.eventBus.emit(eventName, payload),
    };
    resolveEffects(equipment.effects, context, gameState, {
      owner: unit.owner,
      sourceId: equipment.id,
      sourceType: "equipment",
      sourceUnit: unit,
      sourceOwner: unit.owner,
      targetId: unit.id,
    });
  }
}
