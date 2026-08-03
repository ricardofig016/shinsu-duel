/**
 * Generic handler registry for game effects.
 *
 * Each handler is a class with:
 *   - validate(payload, context): boolean
 *   - execute(payload, context, gameState): result
 *
 * Handlers use `context.emitChild()` for cascading effects and the
 * ModifierStack for state changes.
 */

export default class HandlerRegistry {
  constructor() {
    /** @type {Map<string, import('./handlers/BaseHandler.js').default>} */
    this._handlers = new Map();
  }

  /**
   * @param {string} name
   * @param {typeof import('./handlers/BaseHandler.js').default} HandlerClass
   */
  register(name, HandlerClass) {
    this._handlers.set(name, new HandlerClass());
  }

  /**
   * @param {string} name
   * @returns {import('./handlers/BaseHandler.js').default}
   */
  get(name) {
    const handler = this._handlers.get(name);
    if (!handler) throw new Error(`Unknown handler: "${name}"`);
    return handler;
  }

  /**
   * @param {string} name
   * @returns {boolean}
   */
  has(name) {
    return this._handlers.has(name);
  }

  /**
   * @returns {string[]}
   */
  names() {
    return [...this._handlers.keys()];
  }

  /**
   * Execute a handler by name.
   */
  execute(name, payload, context, gameState) {
    const handler = this.get(name);
    handler.validate(payload, context);
    return handler.execute(payload, context, gameState);
  }
}
