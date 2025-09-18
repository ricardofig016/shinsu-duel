export default class PassiveAbility {
  /**
   * Represents a passive ability that is always active while its unit is in play
   * @param {string} code - unique identifier
   * @param {string} text - text to display on the card
   * @param {object} params - additional parameters
   */
  constructor(code, text, params = {}) {
    this.code = code;
    this.text = text;
    this.params = params;
    this.subscriptions = []; // clean up functions for event subscriptions
  }

  // Called when the unit enters the field
  activate(unit, gameState) {
    this.registerListeners(unit, gameState);
  }

  // Called when the unit leaves the field
  deactivate(unit, gameState) {
    // Clean up all registered event listeners
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
  }

  // Register event listeners
  registerListeners(unit, gameState) {
    // Subclasses will implement this
  }

  // Helper to safely register an event and track its unsubscribe function
  registerEvent(eventBus, eventName, handler) {
    const unsubscribe = eventBus.subscribe(eventName, handler);
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }
}
