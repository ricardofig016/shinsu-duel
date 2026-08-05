/**
 * Pluggable attribute engine registry.
 *
 * When a unit is deployed, its attributes are looked up here and the
 * corresponding engine's onDeploy() is called. Engines manage their own
 * event subscriptions and cleanup.
 */

export default class AttributeRegistry {
  constructor() {
    /** @type {Map<string, object>} */
    this._engines = new Map();
  }

  /**
   * @param {string} name — attribute code (e.g., "anima", "hwayeomsa")
   * @param {object} engine — engine instance with onDeploy(unit, gameState)
   */
  register(name, engine) {
    this._engines.set(name, engine);
  }

  /**
   * @param {string} name
   * @returns {object|null}
   */
  get(name) {
    return this._engines.get(name) || null;
  }

  /**
   * Call onDeploy for each attribute on a unit.
   */
  onUnitDeployed(unit, gameState) {
    const attributes = unit.card?.attributes || [];
    for (const attr of attributes) {
      const engine = this._engines.get(attr);
      if (engine && typeof engine.onDeploy === "function") {
        engine.onDeploy(unit, gameState);
      }
    }
  }

  /**
   * Clean up attribute subscriptions when unit leaves play.
   */
  onUnitRemoved(unit, gameState) {
    const attributes = unit.card?.attributes || [];
    for (const attr of attributes) {
      const engine = this._engines.get(attr);
      if (engine && typeof engine.cleanup === "function") {
        engine.cleanup(unit, gameState);
      }
    }
  }
}
