import UnitService from "../services/UnitService.js";
import LifecycleEngine from "../services/LifecycleEngine.js";
import Card from "../Card.js";
import { findCardsByName } from "../utils/cardData.js";

/**
 * Jeonsulsa attribute engine — the enemy Conduit.
 *
 * Core mechanic (RULES.md):
 *   Deploy: summon a Conduit on the enemy backline (or, when one already
 *   exists, permanently grant it +2 max HP). The Conduit plays a random
 *   Jeonsul Baang on a random ally for every 2 HP it has at round start and
 *   on Activation, and Slays itself while no enemy Jeonsulsa is on the field.
 *
 * The deploy effect is the engine's whole surface: the Conduit's own
 * behavior lives in its card passives and runs through PassiveManager, so
 * the engine subscribes to no events and needs no cleanup.
 */
export default class JeonsulsaEngine {
  constructor(eventBus, cards) {
    this._bus = eventBus;
    this._cards = cards;
  }

  /**
   * Called when a Jeonsulsa unit is deployed.
   *
   * Grants the enemy Conduit +2 max and current HP, or summons one on the
   * enemy backline when none exists. Runs inside `_placeOnField` while the
   * deploying unit is still being wired, so a summoned Conduit re-enters the
   * full placement pipeline (native traits, passives, attribute engines,
   * event chain) and its `UNIT_DEPLOYED`/`UNIT_SUMMONED` events fire before
   * the deploying unit's own.
   */
  onDeploy(unit, gameState) {
    if (!unit || !gameState) return;

    const enemyOwner = gameState.usernames.find((username) => username !== unit.owner);
    const conduit = this._findConduit(gameState, enemyOwner);
    if (conduit) {
      UnitService.grantHp(conduit, 2);
      return;
    }

    const conduitData = findCardsByName(this._cards, "Conduit", "unit")[0];
    if (!conduitData) return;
    const card = new Card(conduitData.cardId, conduitData, enemyOwner, gameState.eventBus);
    LifecycleEngine.summonUnit(gameState, enemyOwner, card, "backline");
  }

  _findConduit(gameState, owner) {
    const field = gameState.playerStates[owner]?.field;
    if (!field) return null;
    return [...(field.frontline || []), ...(field.backline || [])]
      .find((unit) => unit.card?.kind === "conduit") ?? null;
  }
}
