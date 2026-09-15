import LifecycleEngine from "../services/LifecycleEngine.js";
import Card from "../Card.js";
import { findCardsByName } from "../utils/cardData.js";
import { resolveEffect } from "../EffectResolver.js";

/**
 * Jeonsulsa attribute engine — the enemy Conduit.
 *
 * Core mechanic (RULES.md):
 *   Deploy: heal the enemy Conduit 2 HP (capped at its fixed 8 max HP), or,
 *   when none exists, summon one on the enemy backline — fizzling when that
 *   backline is already full. The Conduit plays a random Jeonsul Baang on a
 *   random ally for every 2 HP it has at round start and on Activation, and
 *   Slays itself while no enemy Jeonsulsa is on the field.
 *
 * The deploy effect is the engine's whole surface: the Conduit's own
 * behavior lives in its card passives and runs through PassiveManager, so
 * the engine subscribes to no events and needs no cleanup. The heal routes
 * through the standard `heal` handler — modifiers, capping, and the
 * `HEAL_APPLIED` announcement behave exactly as for any other heal, with the
 * deploying Jeonsulsa as the heal's source.
 */
export default class JeonsulsaEngine {
  constructor(eventBus, cards) {
    this._bus = eventBus;
    this._cards = cards;
  }

  /**
   * Called when a Jeonsulsa unit is deployed.
   *
   * Heals the enemy Conduit 2 HP, or summons one on the enemy backline when
   * none exists. Runs inside `_placeOnField` while the deploying unit is
   * still being wired, so a summoned Conduit re-enters the full placement
   * pipeline (native traits, passives, attribute engines, event chain) and
   * its `UNIT_DEPLOYED`/`UNIT_SUMMONED` events fire before the deploying
   * unit's own.
   */
  onDeploy(unit, gameState) {
    if (!unit || !gameState) return;

    const enemyOwner = gameState.usernames.find((username) => username !== unit.owner);
    const conduit = this._findConduit(gameState, enemyOwner);
    if (conduit) {
      this._healConduit(unit, conduit, gameState);
      return;
    }

    const conduitData = findCardsByName(this._cards, "Conduit", "unit")[0];
    if (!conduitData) return;
    const card = new Card(conduitData.cardId, conduitData, enemyOwner, gameState.eventBus);
    LifecycleEngine.summonUnit(gameState, enemyOwner, card, "backline");
  }

  /**
   * Heal the Conduit through the standard heal pipeline. The engine runs
   * inside the deploying unit's placement, outside any event chain, so the
   * heal resolves under a standalone root context: `HEAL_APPLIED` still
   * reaches every subscriber, and heal modifiers on the deploying Jeonsulsa
   * apply.
   */
  _healConduit(source, conduit, gameState) {
    const context = gameState.eventBus.createRootContext("attribute:jeonsulsa:deploy");
    resolveEffect(
      { type: "heal", amount: 2, targetId: conduit.id },
      context,
      gameState,
      {
        sourceUnit: source,
        sourceId: source.id,
        sourceType: "attribute",
      },
    );
  }
  _findConduit(gameState, owner) {
    const field = gameState.playerStates[owner]?.field;
    if (!field) return null;
    return [...(field.frontline || []), ...(field.backline || [])]
      .find((unit) => unit.card?.kind === "conduit") ?? null;
  }
}
