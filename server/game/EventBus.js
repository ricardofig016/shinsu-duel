const PHASE_ORDER = ["pre", "execute", "post", "resolved"];
const PHASES = new Set(PHASE_ORDER);

function normalizePhase(phase) {
  const normalized = String(phase ?? "execute").toLowerCase();
  if (!PHASES.has(normalized)) {
    throw new Error(`Invalid event phase: ${phase}`);
  }
  return normalized;
}

function validateEventName(eventName) {
  if (typeof eventName !== "string" || eventName.trim().length === 0) {
    throw new Error("Event name must be a non-empty string");
  }
}

function validateHandler(handler) {
  if (typeof handler !== "function") {
    throw new Error("Event handler must be a function");
  }
}

/**
 * Deterministic publish/subscribe bus for game events.
 *
 * `emit` dispatches one phase at a time. Handlers may mutate the payload in
 * place. PRE and EXECUTE handlers can cancel the event through the context
 * passed as their second argument.
 */
export default class EventBus {
  static PHASES = Object.freeze([...PHASE_ORDER]);

  constructor() {
    this.listeners = new Map();
    this.registrationOrder = 0;
  }

  /**
   * Register a handler.
   * @param {string} eventName Event name, or `*` for every event.
   * @param {Function} handler Event callback `(payload, context)`.
   * @param {{phase?: string, priority?: number}} options Registration options.
   * @returns {Function} Unsubscribe function.
   */
  on(eventName, handler, options = {}) {
    validateEventName(eventName);
    validateHandler(handler);

    const phase = normalizePhase(options.phase);
    const priority = options.priority ?? 0;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new Error("Event handler priority must be a finite number");
    }

    const entry = {
      eventName,
      handler,
      phase,
      priority,
      order: this.registrationOrder++,
      once: false,
    };
    const handlers = this.listeners.get(eventName) || [];
    handlers.push(entry);
    this.listeners.set(eventName, handlers);

    return () => this.#removeEntry(entry);
  }

  /**
   * Register a handler that is removed before it can run a second time.
   */
  once(eventName, handler, options = {}) {
    const unsubscribe = this.on(eventName, handler, options);
    const handlers = this.listeners.get(eventName);
    const entry = handlers?.findLast((candidate) => candidate.handler === handler && !candidate.once);
    if (entry) entry.once = true;
    return unsubscribe;
  }

  /**
   * Remove all registrations for the handler on an event.
   */
  off(eventName, handler) {
    validateEventName(eventName);
    validateHandler(handler);

    const handlers = this.listeners.get(eventName);
    if (!handlers) return;

    const remaining = handlers.filter((entry) => entry.handler !== handler);
    if (remaining.length === 0) this.listeners.delete(eventName);
    else this.listeners.set(eventName, remaining);
  }

  /**
   * Remove all handlers for one event. With no event name, remove everything.
   */
  removeAllListeners(eventName = undefined) {
    if (eventName === undefined) {
      this.listeners.clear();
      return;
    }

    validateEventName(eventName);
    this.listeners.delete(eventName);
  }

  /**
   * Emit one phase of an event.
   *
   * @returns {{eventName: string, phase: string, modifiedPayload: any, cancelled: boolean, results: any[]}}
   */
  emit(eventName, payload = {}, options = {}) {
    validateEventName(eventName);
    const phase = normalizePhase(options.phase);
    const handlers = [
      ...(this.listeners.get(eventName) || []),
      ...(this.listeners.get("*") || []),
    ]
      .filter((entry) => entry.phase === phase)
      .sort((left, right) => left.priority - right.priority || left.order - right.order);

    const context = {
      eventName,
      phase,
      cancelled: false,
      reason: undefined,
      cancel: (reason = undefined) => {
        context.cancelled = true;
        context.reason = reason;
      },
    };
    const results = [];

    for (const entry of handlers) {
      if (entry.once) this.#removeEntry(entry);
      try {
        const result = entry.handler(payload, context);
        results.push(result);
        if (result === false && (phase === "pre" || phase === "execute")) {
          context.cancel();
        }
      } catch (error) {
        const wrappedError = new Error(`Error in EventBus handler for "${eventName}" (${phase}): ${error.message}`);
        wrappedError.cause = error;
        throw wrappedError;
      }
    }

    return {
      eventName,
      phase,
      modifiedPayload: payload,
      cancelled: context.cancelled,
      reason: context.reason,
      results,
    };
  }

  /**
   * Legacy adapter. Existing callers publish execute events; POST handlers
   * also run so logging and post-apply reactions continue to work.
   */
  publish(eventName, payload = {}) {
    const executeResult = this.emit(eventName, payload, { phase: "execute" });
    const postResult = this.emit(eventName, payload, { phase: "post" });
    const resolvedResult = this.emit(eventName, payload, { phase: "resolved" });
    return {
      ...resolvedResult,
      cancelled: executeResult.cancelled || postResult.cancelled || resolvedResult.cancelled,
      reason: executeResult.reason ?? postResult.reason ?? resolvedResult.reason,
      results: [...executeResult.results, ...postResult.results, ...resolvedResult.results],
    };
  }

  // Legacy method names retained while game callers migrate to on/off/emit.
  subscribe(eventName, handler, options = {}) {
    return this.on(eventName, handler, options);
  }

  unsubscribe(eventName, handler) {
    return this.off(eventName, handler);
  }

  #removeEntry(entry) {
    const handlers = this.listeners.get(entry.eventName);
    if (!handlers) return;

    const remaining = handlers.filter((candidate) => candidate !== entry);
    if (remaining.length === 0) this.listeners.delete(entry.eventName);
    else this.listeners.set(entry.eventName, remaining);
  }
}
