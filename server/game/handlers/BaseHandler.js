/**
 * Base class for all effect handlers.
 *
 * Handlers receive a payload, context (for emitChild/cancel), and gameState.
 * They must use the ModifierStack for state changes — never mutate directly.
 */

export default class BaseHandler {
  /**
   * Validate that a value is a positive finite integer.
   */
  static requirePositiveInt(value, label = "value") {
    if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive integer, got ${value}`);
    }
    return value;
  }

  /**
   * Validate the payload before execution. Throws on invalid input.
   * @param {object} payload
   * @param {import('../EventBus.js').EventContext} context
   */
  validate(payload, context) {
    // Override in subclasses
  }

  /**
   * Execute the handler's effect.
   * @param {object} payload
   * @param {import('../EventBus.js').EventContext} context
   * @param {import('../GameState.js').default} gameState
   * @returns {*} Result of the effect.
   */
  execute(payload, context, gameState) {
    throw new Error("execute() must be implemented by subclass");
  }
}
