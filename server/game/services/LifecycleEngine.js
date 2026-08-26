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
import UnitService from "./UnitService.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";
import { resolveEffect, resolveEffects } from "../EffectResolver.js";
import ModifierService from "./ModifierService.js";

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

    // Validate it's player's turn
    if (gameState.currentTurn !== username) throw new Error("It's not your turn.");

    // Read first: service callers must never lose a card because a later
    // lifecycle validation fails.
    const card = player.hand?.[handIndex];
    if (!card || card.type !== "unit") throw new Error("Card is not a unit or not in hand.");

    // Resolve the field line and validate the position code against the card's
    // kind. Standard units must occupy a printed position; special kinds carry
    // no position (their line is authored or implied by kind).
    const line = LifecycleEngine._lineForCard(gameState, card, positionCode);
    if (card.kind === "standard" && !(positionCode in card.positions)) {
      throw new Error(`Card "${card.name}" cannot be placed in position "${positionCode}".`);
    }

    // Compression is a reduction on this card instance. It remains attached to this card until it is played.
    const cost = ModifierService.getEffectiveCost(card, username, gameState);

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

    // Landmark replacement: at most one landmark per player.
    if (card.kind === "landmark") {
      const existingLandmark = (player.field?.backline || [])
        .find((u) => u.card?.kind === "landmark");
      if (existingLandmark) {
        LifecycleEngine.destroyUnit(gameState, existingLandmark);
      }
    }

    const fieldLine = player.field[line];

    // A field line may never temporarily exceed its five-unit capacity. When
    // deployment would overflow, defer *all* deployment mutations until the
    // owner chooses which of the five current units or the pending card to
    // destroy. The card remains in hand and no cost is paid while the choice
    // is pending, so the continuation is atomic from the board's perspective.
    if (fieldLine.length >= 5 && !options.overflowSelection) {
      const pendingCardId = `pending-deploy:${card.id}`;
      gameState.createPendingDecision({
        owner: username,
        type: "line_overflow",
        candidates: [
          ...fieldLine.map((candidate) => ({
            id: candidate.id,
            name: candidate.card.name,
            hp: candidate.currentHp,
          })),
          { id: pendingCardId, name: card.name, hp: card.maxHp },
        ],
        resolve: ([selectedId]) => {
          // A pending decision blocks player actions, but validate the card
          // identity and capacity again to keep this continuation safe when
          // future system effects can resolve while a decision is open.
          const pendingCard = player.hand?.[handIndex];
          if (pendingCard !== card) {
            throw new Error("Pending overflow deployment card is no longer in hand.");
          }

          if (selectedId === pendingCardId) {
            // The pending card is a valid overflow choice. It is paid for and
            // discarded as the deployment's destroyed unit, but is never put
            // on the field, preserving the five-unit invariant.
            ZoneService.removeFromHand(player, handIndex);
            ShinsuService.spend(player, cost);
            ZoneService.discard(player, card);
            return;
          }

          const selectedUnit = gameState._findUnit(selectedId);
          if (!selectedUnit || !fieldLine.includes(selectedUnit)) {
            throw new Error("Selected overflow unit is no longer in the deployment line.");
          }
          LifecycleEngine.destroyUnit(gameState, selectedUnit);
          LifecycleEngine.deployUnit(gameState, username, handIndex, positionCode, {
            ...options,
            overflowSelection: true,
          });
        },
      });
      return { unit: null, overflowDestroyed: true, pending: true };
    }

    // Mutate only after every synchronous validation above has succeeded.
    ZoneService.removeFromHand(player, handIndex);
    ShinsuService.spend(player, cost);

    const unit = LifecycleEngine._placeOnField(gameState, card, username, positionCode, cost);

    return { unit, overflowDestroyed: false, pending: false };
  }

  /**
   * Resolve the field line a card occupies.
   *
   * Standard units occupy the line of their chosen position; shinheuh occupy
   * their authored `line`; landmarks and the conduit always occupy the
   * backline. `positionCode` is only meaningful for standard units.
   */
  static _lineForCard(gameState, card, positionCode) {
    if (card.kind === "shinheuh") {
      if (!card.line) throw new Error(`Shinheuh "${card.name}" has no line.`);
      return card.line;
    }
    if (card.kind === "landmark" || card.kind === "conduit") {
      return "backline";
    }
    const positionDef = gameState.constructor.positions[positionCode];
    if (!positionDef) throw new Error(`Invalid position: "${positionCode}"`);
    return positionDef.line;
  }

  /**
   * Create a unit from a card instance, wire native traits/triggers/passives/
   * attributes, and emit the deploy/summon event chain. The sole path that
   * puts a fully-wired unit onto a field line — shared by deployment and
   * summoning. Line capacity must be guaranteed by the caller.
   */
  static _placeOnField(gameState, card, owner, positionCode, cost) {
    const line = LifecycleEngine._lineForCard(gameState, card, positionCode);
    const placedPositionCode = card.kind === "standard" ? positionCode : null;
    // Field placement is the single ownership boundary for deployed and
    // summoned units: the receiving player owns the card.
    card.owner = owner;
    const unit = new Unit(card, placedPositionCode, line);
    gameState.playerStates[owner].field[line].push(unit);
    gameState._indexUnit(unit);

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

    gameState._passiveManager?.registerUnit(unit, gameState);

    // Wire attribute engines
    if (gameState._attributeRegistry) {
      gameState._attributeRegistry.onUnitDeployed(unit, gameState);
    }

    // Register landmark rules (always-on battlefield rules, distinct from passives).
    if (card.kind === "landmark" && gameState._globalRuleRegistry) {
      gameState._globalRuleRegistry.registerUnit(unit, gameState);
    }

    // Emit the deploy event chain AFTER the unit is fully wired. `unit:deployed`
    // announces battlefield entry; `unit:summoned` is the canonical event for
    // `deploy` triggers, so the unit's complete observable state (native traits,
    // evolution triggers, passives, attribute engines) must exist first.
    gameState.eventBus.emit(EVT.UNIT_DEPLOYED, {
      username: owner,
      unit,
      positionCode,
      cost,
    });

    gameState.eventBus.emit(EVT.UNIT_SUMMONED, {
      username: owner,
      unit,
      unitId: unit.id,
    });

    return unit;
  }

  /**
   * Remove a unit from its field line without touching zones, subscriptions,
   * or modifiers. Shared by `destroyUnit` and `stealUnit` so a unit is removed
   * from the board in exactly one place.
   */
  static _removeFromField(gameState, unit) {
    for (const username of gameState.usernames) {
      const field = gameState.playerStates[username]?.field;
      if (!field) continue;
      for (const line of ["frontline", "backline"]) {
        const idx = (field[line] || []).indexOf(unit);
        if (idx !== -1) {
          field[line].splice(idx, 1);
          return;
        }
      }
    }
  }

  /**
   * Summon a unit onto a battlefield without paying its cost, spending a
   * combat slot, or ending the turn (RULES.md §Shinheuh).
   *
   * Enforces same-name uniqueness: a summoned copy of a unit already on the
   * owner's board is discarded. A full destination line defers to the same
   * line-overflow decision used by deployment.
   *
   * @param {GameState} gameState
   * @param {string} owner — the player whose field receives the unit
   * @param {Card} card — the unit card instance to summon
   * @param {string} positionCode — a legal position printed on the card
   */
  static summonUnit(gameState, owner, card, positionCode) {
    const player = gameState.playerStates[owner];
    if (!player) throw new Error(`Player "${owner}" not found`);
    const line = LifecycleEngine._lineForCard(gameState, card, positionCode);

    const existingSame = player.field?.frontline
      ?.concat(player.field?.backline || [])
      .find((u) => u.card?.name === card.name);
    if (existingSame) {
      ZoneService.discard(player, card);
      return { unit: null, discardedDuplicate: true, pending: false };
    }

    const fieldLine = player.field[line];
    if (fieldLine.length >= 5) {
      const pendingCardId = `pending-summon:${card.id}`;
      gameState.createPendingDecision({
        owner,
        type: "line_overflow",
        candidates: [
          ...fieldLine.map((candidate) => ({
            id: candidate.id,
            name: candidate.card.name,
            hp: candidate.currentHp,
          })),
          { id: pendingCardId, name: card.name, hp: card.maxHp },
        ],
        resolve: ([selectedId]) => {
          if (selectedId === pendingCardId) {
            ZoneService.discard(player, card);
            return;
          }
          const selectedUnit = gameState._findUnit(selectedId);
          if (!selectedUnit || !fieldLine.includes(selectedUnit)) {
            throw new Error("Selected overflow unit is no longer in the destination line.");
          }
          LifecycleEngine.destroyUnit(gameState, selectedUnit);
          LifecycleEngine._placeOnField(gameState, card, owner, positionCode, 0);
        },
      });
      return { unit: null, overflowDestroyed: true, pending: true };
    }

    const unit = LifecycleEngine._placeOnField(gameState, card, owner, positionCode, 0);
    return { unit, overflowDestroyed: false, pending: false };
  }

  /**
   * Move a deployed unit to another player's field (steal). Ownership is
   * reassigned; the unit's modifiers, subscriptions, and identity are kept
   * intact. A full destination line defers to the same line-overflow decision
   * as summoning.
   *
   * @param {GameState} gameState
   * @param {object} unit — the deployed unit to steal
   * @param {string} newOwner — the player receiving the unit
   * @param {string} positionCode — a legal position printed on the card
   */
  static stealUnit(gameState, unit, newOwner, positionCode) {
    if (!unit || !unit.isAlive()) return { stolen: false };
    const newPlayer = gameState.playerStates[newOwner];
    if (!newPlayer) throw new Error(`Player "${newOwner}" not found`);
    const newLine = LifecycleEngine._lineForCard(gameState, unit.card, positionCode);
    const line = newPlayer.field[newLine];

    if (line.length >= 5) {
      const pendingId = `pending-steal:${unit.id}`;
      gameState.createPendingDecision({
        owner: newOwner,
        type: "line_overflow",
        candidates: [
          ...line.map((candidate) => ({
            id: candidate.id,
            name: candidate.card.name,
            hp: candidate.currentHp,
          })),
          { id: pendingId, name: unit.card.name, hp: unit.card.maxHp },
        ],
        resolve: ([selectedId]) => {
          if (selectedId === pendingId) {
            LifecycleEngine._removeFromField(gameState, unit);
            ZoneService.discard(gameState.playerStates[unit.owner], unit.card);
            return;
          }
          const selectedUnit = gameState._findUnit(selectedId);
          if (!selectedUnit || !line.includes(selectedUnit)) {
            throw new Error("Selected overflow unit is no longer in the destination line.");
          }
          LifecycleEngine.destroyUnit(gameState, selectedUnit);
          LifecycleEngine.stealUnit(gameState, unit, newOwner, positionCode);
        },
      });
      return { stolen: true, pending: true };
    }

    LifecycleEngine._removeFromField(gameState, unit);
    unit.owner = newOwner;
    unit.card.owner = newOwner;
    line.push(unit);
    unit.placedPositionCode = unit.card.kind === "standard" ? positionCode : null;
    unit.line = newLine;
    gameState._indexUnit(unit);
    gameState.eventBus.emit(EVT.UNIT_STOLEN, {
      unitId: unit.id,
      unit,
      owner: newOwner,
    });
    return { stolen: true, pending: false };
  }

  /**
   * Destroy a unit: remove from field, move card to discard,
   * clean up ModifierStack, detach equipment.
   * Idempotent — calling destroy on an already-destroyed unit is a no-op.
   */
  static destroyUnit(gameState, unit) {
    if (!unit) return;

    // Idempotency guard: if the unit is already not on the field, skip.
    const stillOnField = gameState._findUnit(unit.id);
    if (!stillOnField || stillOnField !== unit) return;

    // Emit pre-destroy intent (can be cancelled by handlers)
    const result = gameState.eventBus.emit(EVT.UNIT_DESTROY_INTENT, {
      unitId: unit.id,
      unit,
    });
    if (result?.cancelled) return;

    // Detach equipment — returns to hand (de-ignited per RULES.md)
    if (LifecycleEngine._getEquipment(unit).length > 0) {
      LifecycleEngine.detachEquipment(gameState, unit);
    }

    // Remove from field
    gameState._unindexUnit(unit.id);
    LifecycleEngine._removeFromField(gameState, unit);

    // Move card to discard
    const player = gameState.playerStates[unit.owner];
    if (player) {
      ZoneService.discard(player, unit.card);
    }

    gameState._triggerManager?.unregisterAll(unit.id);
    gameState._passiveManager?.unregisterUnit(unit.id);
    // Revoke any always-on grants this unit's passives still hold on other
    // units (e.g. "while I'm on the field, allies have X"). unregisterUnit only
    // drops subscriptions; revokeGrants clears the modifiers keyed to this
    // unit's passive source IDs so they never outlive the source. Ordered after
    // unregister so the revoke events can't re-trigger the outgoing handlers.
    gameState._passiveManager?.revokeGrants(unit.id, unit.card?.passiveAbilities || [], gameState);
    gameState._globalRuleRegistry?.unregisterUnit(unit.id, gameState);
    gameState._attributeRegistry?.onUnitRemoved(unit, gameState);
    // AbilityRegistry cleanup is handled by the ModifierStack.onRevoke bridge
    // (triggered by the UNIT_DESTROYED → removeByTarget cascade below).

    // Emit destroyed event (ModifierStack auto-cleans via listener)
    gameState.eventBus.emit(EVT.UNIT_DESTROYED, {
      unitId: unit.id,
      unit,
      owner: unit.owner,
    });
  }

  /**
   * Kill a unit through the full lethal pipeline: death-intent (Undying can
   * intercept) → unit:killed (Slay/kill triggers fire) → destroyUnit.
   *
   * Shared by `slay` (direct kill, ignoring damage) and the lethal tail of
   * damage resolution, so both paths honor cheat-death and on-kill triggers
   * identically.
   *
   * @param {GameState} gameState
   * @param {object} unit — the unit to kill
   * @param {object} [options]
   * @param {string} [options.sourceId] — the killing source (slayer)
   * @param {string} [options.sourceOwner] — the killing source's owner
   * @param {EventContext} [options.context] — EventContext for DFS child events
   * @param {number} [options.damage] — lethal damage amount (0 for Slay)
   * @returns {{ killed: boolean, undyingSaved?: boolean }}
   */
  static killUnit(gameState, unit, { sourceId, sourceOwner, context, damage = 0 } = {}) {
    if (!unit) return { killed: false };

    const emit = (eventName, payload) =>
      context ? context.emitChild(eventName, payload) : gameState.eventBus.emit(eventName, payload);

    const deathResult = emit(EVT.UNIT_DEATH_INTENT, {
      sourceId,
      targetId: unit.id,
      killerId: sourceId,
      killerOwner: sourceOwner,
      damage,
    });
    if (deathResult?.cancelled) {
      return { killed: false, undyingSaved: true };
    }

    emit(EVT.UNIT_KILLED, {
      sourceId,
      targetId: unit.id,
      killerId: sourceId,
      killerOwner: sourceOwner,
    });

    // Every production lethal path uses the lifecycle engine so zones,
    // attachments, modifiers, attributes, and trigger subscriptions remain
    // coherent. The fallback keeps this independently testable with a minimal
    // state stub.
    if (gameState.playerStates && gameState.eventBus) {
      LifecycleEngine.destroyUnit(gameState, unit);
    } else {
      emit(EVT.UNIT_DESTROYED, { unitId: unit.id, owner: unit.owner || sourceOwner });
    }

    return { killed: true };
  }

  /**
   * Transform a unit: atomically swap definition while preserving state.
   * Used for evolution and ignition transformations.
   *
   * Preserved: HP delta (lost HP stays), conditions, equipment, grants,
   * slot position, identity.
   */
  static transformUnit(gameState, unit, targetCardId) {
    const targetCard = gameState.cards[targetCardId];
    if (!targetCard) throw new Error(`Target card ${targetCardId} not found`);
    if (targetCard.type !== "unit") throw new Error(`Target card ${targetCardId} is not a unit`);

    const lostHp = unit.card.maxHp - unit.currentHp;
    const oldCard = unit.card;

    // Swap card definition while preserving damage. A transformation may enter
    // with 0 HP only when the caller already allowed a lethal state.
    unit.card = new Card(targetCardId, targetCard, unit.owner, gameState.eventBus);
    UnitService.setHp(unit, unit.card.maxHp - lostHp);

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

    // Passives are tied to the card definition, so replacing it must replace
    // its event subscriptions while preserving the unit identity. Revoke the
    // outgoing card's always-on grants after unsubscribing (so the revoke
    // events can't re-trigger the outgoing handlers) and before re-registering.
    gameState._passiveManager?.unregisterUnit(unit.id);
    gameState._passiveManager?.revokeGrants(unit.id, oldCard.passiveAbilities || [], gameState);
    gameState._passiveManager?.registerUnit(unit, gameState);

    // Re-evaluate attribute engines for the transformed unit.
    // The unit may have gained or lost attributes through transformation.
    if (gameState._attributeRegistry) {
      gameState._attributeRegistry.onUnitRemoved(unit, gameState);
      gameState._attributeRegistry.onUnitDeployed(unit, gameState);
    }

    // Emit transformation event
    gameState.eventBus.emit(EVT.UNIT_EVOLVED, {
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
    const targetCard = gameState.cards[targetCardId];
    const attachments = LifecycleEngine._getEquipment(unit);
    const attachmentIndex = equipmentId
      ? attachments.findIndex((entry) => entry.id === equipmentId)
      : 0;
    if (attachmentIndex < 0) throw new Error("Cannot ignite equipment that is not attached.");
    if (!targetCard || targetCard.type !== "equipment") {
      throw new Error(`Target card ${targetCardId} is not equipment`);
    }

    const oldEquipment = attachments[attachmentIndex];
    ModifierService.revokeBySource(gameState, oldEquipment.id);
    const ignited = new Card(targetCardId, targetCard, unit.owner, gameState.eventBus);
    attachments[attachmentIndex] = ignited;
    LifecycleEngine._syncEquipment(unit, attachments);
    LifecycleEngine._resolveEquipmentEffects(gameState, unit, ignited);
    gameState.eventBus.emit(EVT.EQUIPMENT_IGNITED, {
      unitId: unit.id,
      equipment: ignited,
      fromCardId: oldEquipment.cardId,
      toCardId: targetCardId,
    });
  }

  /**
   * Attach equipment to a unit.
   * Living Ignition Weapons retain distinct equipment definitions; all other
   * units replace their existing attachment.
   */
  static attachEquipment(gameState, username, handIndex, targetUnit) {
    const player = gameState.playerStates[username];
    if (!player) throw new Error(`Player "${username}" not found`);

    // As with deployment, read before mutating the hand so direct service
    // use remains transactional when validation fails.
    const card = player.hand?.[handIndex];
    if (!card || card.type !== "equipment") throw new Error("Card is not equipment.");

    const cost = ModifierService.getEffectiveCost(card, username, gameState);
    if (!ShinsuService.canAfford(player, cost)) {
      throw new Error("Not enough shinsu to equip.");
    }

    // Living Ignition Weapons may retain several equipment cards, but each
    // attachment must be a different card definition. Attachments are stored
    // canonically so modifiers and ignition triggers retain card-instance scope.
    const isLivingIgnitionWeapon = gameState.modifierStack.has(
      targetUnit.id,
      "attribute",
      "living-ignition-weapon"
    ) || (targetUnit.card?.attributes || []).includes("living-ignition-weapon");
    const attachments = LifecycleEngine._getEquipment(targetUnit);

    if (isLivingIgnitionWeapon && attachments.some((attached) => attached.cardId === card.cardId)) {
      throw new Error("A Living Ignition Weapon can only equip unique equipment cards.");
    }
    if (attachments.length > 0 && !isLivingIgnitionWeapon) {
      // Normal units replace their existing equipment.
      LifecycleEngine.detachEquipment(gameState, targetUnit, attachments[0]);
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

    gameState.eventBus.emit(EVT.EQUIPMENT_ATTACHED, {
      unitId: targetUnit.id,
      equipment: card,
      sourceId,
    });
  }

  /**
   * Detach one equipment card, or every attachment when no card is specified.
   * Detached ignited cards return as fresh base-form instances to the
   * controller's hand.
   */
  static detachEquipment(gameState, unit, equipment = null) {
    const attachments = LifecycleEngine._getEquipment(unit);
    const toDetach = equipment ? attachments.filter((entry) => entry === equipment) : attachments;
    if (toDetach.length === 0) return;

    // Detach from the canonical attachment list FIRST so always-on passives
    // that gate on `has_equipped`/`has_all_equipped` read the post-detach
    // state when they re-evaluate on the modifier-revoke and detach events
    // emitted below.
    LifecycleEngine._syncEquipment(unit, attachments.filter((entry) => !toDetach.includes(entry)));

    for (const equip of toDetach) {
      LifecycleEngine._detachOne(gameState, unit, equip, "hand", unit.owner);
    }
  }

  /**
   * Detach one equipment card and send it to the controller's discard pile
   * (used by the `discard` effect against `zone: attachments`).
   */
  static discardEquipment(gameState, unit, equipment) {
    const attachments = LifecycleEngine._getEquipment(unit);
    if (!attachments.includes(equipment)) return;
    LifecycleEngine._syncEquipment(unit, attachments.filter((entry) => entry !== equipment));
    LifecycleEngine._detachOne(gameState, unit, equipment, "discard", unit.owner);
  }

  /**
   * Remove all of a unit's equipment and route each card to a destination
   * (the `disarm` effect). Detached ignited cards return as fresh base-form
   * instances. Returns the number of cards detached.
   *
   * @param {GameState} gameState
   * @param {object} unit — the unit whose equipment is removed
   * @param {{ zone?: "hand"|"discard", owner?: string }} dest — where each
   *   detached card goes; `zone` defaults to "hand", `owner` to the unit's
   *   controller.
   */
  static disarmUnit(gameState, unit, { zone = "hand", owner = unit.owner } = {}) {
    const attachments = LifecycleEngine._getEquipment(unit);
    if (attachments.length === 0) return 0;

    const destination = zone === "discard" ? "discard" : "hand";
    const detached = attachments.slice();
    LifecycleEngine._syncEquipment(unit, []);
    for (const equip of detached) {
      LifecycleEngine._detachOne(gameState, unit, equip, destination, owner);
    }
    return detached.length;
  }

  /**
   * Detach a single equipment card: remove its modifiers and ignition
   * subscriptions, route the (de-ignited) card to `destination` ("hand" |
   * "discard") for `destOwner`, and emit `equipment:detached`.
   */
  static _detachOne(gameState, unit, equip, destination, destOwner) {
    ModifierService.revokeBySource(gameState, equip.id);
    gameState._triggerManager?.unregisterAll(unit.id, "ignition", equip.id);
    gameState.unregisterEquipmentTriggers(equip.id);
    // AbilityRegistry cleanup is handled by the ModifierStack.onRevoke bridge
    // (triggered by removeBySource above).

    const player = gameState.playerStates[destOwner];
    let routed = null;
    if (equip.ignitedFrom !== undefined && equip.ignitedFrom !== null) {
      const baseCardData = gameState.cards[equip.ignitedFrom];
      if (baseCardData) {
        routed = new Card(equip.ignitedFrom, baseCardData, destOwner, gameState.eventBus);
      }
    } else {
      equip.owner = destOwner;
      routed = equip;
    }

    if (player && routed) {
      if (destination === "discard") ZoneService.discard(player, routed);
      else ZoneService.addToHand(player, routed);
    }

    gameState.eventBus.emit(EVT.EQUIPMENT_DETACHED, {
      unitId: unit.id,
      equipment: equip,
    });
  }

  static _getEquipment(unit) {
    // Test and effect fixtures may provide lightweight unit-shaped objects.
    // Normalize them to the canonical representation; no legacy equipment
    // property is read or reconstructed.
    if (!Array.isArray(unit.equipmentAttachments)) {
      unit.equipmentAttachments = [];
    }
    return unit.equipmentAttachments;
  }

  static _syncEquipment(unit, equipmentAttachments) {
    unit.equipmentAttachments = equipmentAttachments;
  }

  static _resolveEquipmentEffects(gameState, unit, equipment) {
    const context = {
      emitChild: (eventName, payload) => gameState.eventBus.emit(eventName, payload),
    };
    const extra = {
      owner: unit.owner,
      sourceId: equipment.id,
      sourceType: "equipment",
      sourceUnit: unit,
      sourceOwner: unit.owner,
    };

    for (const effect of equipment.effects || []) {
      // Always-on modifiers (`modify_*`, `retain_equipment`) apply as
      // source-tracked entries and are revoked on detach.
      if (ModifierService.isModifier(effect)) {
        ModifierService.applyModifier(effect, gameState, extra);
        continue;
      }

      // Deferred/triggered effects (e.g. "the bearer's damage-dealing
      // abilities give Exhausted 1") subscribe for the equipment's lifetime.
      // `equip` triggers are the equipment's own attach and resolve now.
      const trigger = effect?.trigger;
      if (trigger && typeof trigger === "object" && trigger.type !== "equip") {
        LifecycleEngine._subscribeEquipmentTrigger(gameState, unit, equipment, effect, extra, context);
        continue;
      }

      resolveEffect(effect, context, gameState, extra);
    }
  }

  /**
   * Subscribe an equipment effect's non-attach trigger (e.g. `deal_damage`).
   * The subscription is scoped to the bearer and removed on detach.
   */
  static _subscribeEquipmentTrigger(gameState, unit, equipment, effect, extra, context) {
    const trigger = effect.trigger;
    if (trigger.type === "deal_damage") {
      gameState.registerEquipmentTriggeredEffect(
        equipment.id,
        EVT.DAMAGE_APPLIED,
        (payload) => payload.sourceId === unit.id,
        (payload) => resolveEffect(effect, context, gameState, { ...extra, targetId: payload.targetId })
      );
      return;
    }
    if (trigger.type === "quick_ability_used") {
      gameState.registerEquipmentTriggeredEffect(
        equipment.id,
        EVT.UNIT_ABILITY_USED,
        (payload) => payload.unitId === unit.id && payload.quick === true,
        () => resolveEffect(effect, context, gameState, extra)
      );
      return;
    }
    throw new Error(`LifecycleEngine: unsupported equipment effect trigger type "${trigger.type}"`);
  }

  /**
   * Move a unit to another position printed on its card.
   *
   * Sole path for position changes: removes the unit from its current line,
   * appends it to the target line, and updates `placedPositionCode`.
   * Validation (ownership, turn, Rooted, position legality, no-op moves)
   * is the caller's responsibility and happens before this mutation.
   *
   * @param {GameState} gameState
   * @param {object} unit — deployed unit owned by a player
   * @param {string} positionCode — target position code
   */
  static switchPosition(gameState, unit, positionCode) {
    const player = gameState.playerStates[unit.owner];
    if (!player) throw new Error(`Player ${unit.owner} not found.`);

    const oldLine = gameState.constructor.positions[unit.placedPositionCode]?.line;
    const newLine = gameState.constructor.positions[positionCode]?.line;
    if (!oldLine || !newLine) {
      throw new Error(`Invalid position transition: ${unit.placedPositionCode} → ${positionCode}.`);
    }

    const oldIndex = player.field[oldLine].indexOf(unit);
    if (oldIndex === -1) throw new Error(`Unit ${unit.id} is not on its expected line.`);

    player.field[oldLine].splice(oldIndex, 1);
    player.field[newLine].push(unit);
    unit.placedPositionCode = positionCode;
  }
}
