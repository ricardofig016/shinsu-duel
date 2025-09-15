export default class EventBus {
  VALID_EVENTS = [
    "OnGameStart",
    "OnGameEnd",
    "OnTurnStart",
    "OnTurnEnd",
    "OnRoundStart",
    "OnRoundEnd",
    "OnDeployUnit",
    "OnSummonUnit",
    "UseAbilityIntent",
    "UseAbilityResolved",
    "UseAbilityApplied",
    "OnAddLighthouses",
    "OnLighthousesChanged", // TODO: this is just a test example, remove later
  ];

  constructor() {
    this.listeners = new Map(); // {eventName: array of subscriber callbacks}
  }

  #validateEventName(eventName) {
    if (!this.VALID_EVENTS.includes(eventName)) {
      throw new Error(`Invalid event name: ${eventName}`);
    }
  }

  /**
   * Subscribe to a named event.
   * @param {string} eventName The name of the event to listen for.
   * @param {Function} handler Callback to invoke when the event is published.
   * @returns {Function} A function you can call to unsubscribe this handler.
   */
  subscribe(eventName, handler) {
    this.#validateEventName(eventName);
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    const handlers = this.listeners.get(eventName);
    handlers.push(handler);

    // Return an unsubscribe function
    return () => {
      this.unsubscribe(eventName, handler);
    };
  }

  /**
   * Unsubscribe a handler from a named event.
   * @param {string} eventName The event name.
   * @param {Function} handler The exact handler function to remove.
   */
  unsubscribe(eventName, handler) {
    this.#validateEventName(eventName);
    const handlers = this.listeners.get(eventName);
    if (!handlers) return;

    const index = handlers.indexOf(handler);
    if (index !== -1) {
      handlers.splice(index, 1);
      // If no more listeners remain, remove the key entirely
      if (handlers.length === 0) {
        this.listeners.delete(eventName);
      }
    }
  }

  /**
   * Publish an event to all subscribed handlers.
   * @param {string} eventName The name of the event to emit.
   * @param {any} payload Data to pass along to each handler.
   */
  publish(eventName, payload = {}) {
    this.#validateEventName(eventName);
    const handlers = this.listeners.get(eventName);
    if (!handlers) return;

    // Call each handler; errors in one handler won't prevent others from running
    handlers.slice().forEach((handler) => {
      try {
        handler(payload);
      } catch (err) {
        console.error(`Error in EventBus handler for "${eventName}":`, err);
      }
    });
  }
}
