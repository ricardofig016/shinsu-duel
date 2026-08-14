/**
 * Deterministic depth-first event bus for Shinsu Duel.
 *
 * ## Phases
 *
 *  pre      — Modify payload, cancel the event. Runs before state mutation.
 *  execute  — The main effect / state mutation happens here.
 *  post     — Reactions to the resolved effect (e.g. "when damaged", "when killed").
 *  resolved — Logging, cleanup. Cannot trigger new events.
 *
 * ## DFS execution model
 *
 * When a handler calls `context.emitChild(eventName, payload)`, that child
 * event goes through its ENTIRE lifecycle (all 4 phases + any grandchildren)
 * BEFORE the next handler at the parent level runs.
 *
 * This preserves causality: you see one chain resolve completely before
 * another begins.
 *
 * ## Ordering within a phase
 *
 *  1. priority (ascending — lower runs first)
 *  2. sourceAge (ascending — older sources run first)
 *  3. registrationOrder (ascending — first registered runs first)
 *
 * ## Cancellation
 *
 * A `pre` or `execute` handler may call `context.cancel(reason)`. The current
 * phase stops immediately. Child events that already ran are NOT rolled back.
 *
 * ## Handler roles
 *
 * Every handler is classified at registration via `options.role`:
 *
 *  - `authoritative` (default) — transactional state mutations. A failure
 *    aborts the whole event transaction: dispatch stops at the exact
 *    deterministic point (priority, source age, registration order) and the
 *    wrapped error is rethrown to the original `emit` caller. State written
 *    before the failure is NOT rolled back, so authoritative handlers must
 *    validate everything before mutating anything.
 *  - `observer` — read-only reactions (logging, telemetry). A failure is
 *    isolated: the error is recorded on the emit result under
 *    `observerErrors` and dispatch continues. Observers must never mutate
 *    authoritative state, so their failure cannot corrupt the transaction.
 *
 * ## Transaction boundary
 *
 * A root `emit()` is a single transaction. Every `emitChild` chain spawned
 * during its resolution belongs to the same transaction: an authoritative
 * failure anywhere in the DFS chain aborts the entire transaction and
 * propagates to the root caller. Cancellation and failure ordering are
 * deterministic for identical inputs.
 */

const PHASE_ORDER = ["pre", "execute", "post", "resolved"];
const PHASES = new Set(PHASE_ORDER);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function validateEventName(name) {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Event name must be a non-empty string");
  }
}

function validateHandler(fn) {
  if (typeof fn !== "function") {
    throw new Error("Event handler must be a function");
  }
}

function normalizePhase(raw) {
  const p = String(raw ?? "execute").toLowerCase();
  if (!PHASES.has(p)) throw new Error(`Invalid event phase: ${raw}`);
  return p;
}

const ROLES = new Set(["authoritative", "observer"]);

function normalizeRole(raw) {
  const r = String(raw ?? "authoritative").toLowerCase();
  if (!ROLES.has(r)) throw new Error(`Invalid event handler role: ${raw}`);
  return r;
}

/**
 * Build the sort key for handler ordering:
 *   [priority, sourceAge, registrationOrder]
 */
function sortKey(e) {
  return (e.priority * 1e12) + (e.sourceAge * 1e6) + e.order;
}

// ---------------------------------------------------------------------------
// EventContext
// ---------------------------------------------------------------------------

class EventContext {
  constructor(eventBus, eventName, phase, depth) {
    this._bus = eventBus;
    this.eventName = eventName;
    this.phase = phase;
    this.depth = depth;
    this._cancelled = false;
    this._cancelReason = null;
    this._children = [];       // records child event results for logging
    this.observerErrors = [];  // wrapped observer failures (isolated, non-fatal)
  }

  /**
   * Cancel the current event. No further phases execute.
   * Child events that already ran are NOT rolled back.
   */
  cancel(reason = "cancelled") {
    this._cancelled = true;
    this._cancelReason = reason;
  }

  get cancelled() {
    return this._cancelled;
  }

  /**
   * Emit a child event **now** (DFS). The child resolves completely
   * before this call returns.
   */
  emitChild(eventName, payload) {
    const result = this._bus._emitInternal(eventName, payload, this.depth + 1);
    this._children.push({ eventName, result });
    return result;
  }
}

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------

export default class EventBus {
  static PHASES = Object.freeze([...PHASE_ORDER]);

  /**
   * @param {import('./GameClock.js').default} [clock] Shared clock for
   *   deterministic source-age assignment. Creates its own if omitted.
   * @param {number} [maxDepth=50] Maximum DFS nesting before throwing.
   */
  constructor(clock, maxDepth = 50) {
    /** @type {Map<string, Array<object>>} */
    this._listeners = new Map();
    this._registrationOrder = 0;
    this._clock = clock ?? { now: () => 0 };
    this._maxDepth = maxDepth;
  }

  // -----------------------------------------------------------------------
  // Registration
  // -----------------------------------------------------------------------

  /**
   * Register a persistent handler.
   *
   * @param {string} eventName  Event name or `"*"` for all events.
   * @param {Function} handler  `(payload, context) => void`.
   * @param {object} [options]
   * @param {string} [options.phase="execute"]
   * @param {number} [options.priority=0]
   * @param {number} [options.sourceAge]  Source age for tiebreaking. Uses clock if omitted.
   * @param {"authoritative"|"observer"} [options.role="authoritative"]
   * @returns {Function} Unsubscribe function.
   */
  on(eventName, handler, options = {}) {
    validateEventName(eventName);
    validateHandler(handler);

    const entry = this._createEntry(eventName, handler, options);

    const list = this._listeners.get(eventName) || [];
    list.push(entry);
    this._listeners.set(eventName, list);

    return () => this._removeEntry(eventName, entry);
  }

  /**
   * Register a one-shot handler. Removed after its first invocation.
   */
  once(eventName, handler, options = {}) {
    const entry = this._createEntry(eventName, handler, options);
    entry.once = true;

    const list = this._listeners.get(eventName) || [];
    list.push(entry);
    this._listeners.set(eventName, list);

    return () => this._removeEntry(eventName, entry);
  }

  /**
   * Remove a specific handler.
   */
  off(eventName, handler) {
    validateEventName(eventName);
    if (typeof handler !== "function") return;

    const list = this._listeners.get(eventName);
    if (!list) return;

    const filtered = list.filter((e) => e.handler !== handler);
    if (filtered.length === 0) this._listeners.delete(eventName);
    else this._listeners.set(eventName, filtered);
  }

  /**
   * Remove all listeners for a given event, or all listeners entirely.
   */
  removeAllListeners(eventName) {
    if (eventName === undefined) {
      this._listeners.clear();
    } else {
      validateEventName(eventName);
      this._listeners.delete(eventName);
    }
  }

  // -----------------------------------------------------------------------
  // Emission
  // -----------------------------------------------------------------------

  /**
   * Public entry point. Runs all 4 phases in order.
   *
   * @param {string} eventName
   * @param {*} payload            Will be mutated in-place by handlers.
   * @param {object} [options]
   * @param {string} [options.phase]  Only run a single phase (for partial emits).
   * @returns {{ cancelled: boolean, reason: string|null, finalPayload: *, children: Array, observerErrors: Array<Error> }}
   */
  emit(eventName, payload = {}, options = {}) {
    if (options.phase) {
      // Single-phase mode
      return this._emitSinglePhase(eventName, payload, options.phase);
    }
    return this._emitInternal(eventName, payload, 0);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  /** @private */
  _emitInternal(eventName, payload, depth) {
    if (depth > this._maxDepth) {
      throw new Error(
        `EventBus max recursion depth (${this._maxDepth}) exceeded at "${eventName}". ` +
        `Check for infinite event loops.`
      );
    }

    validateEventName(eventName);

    const rootCtx = new EventContext(this, eventName, "pre", depth);

    for (const phase of PHASE_ORDER) {
      if (rootCtx._cancelled) break;
      rootCtx.phase = phase;

      const handlers = this._collectHandlers(eventName, phase);

      for (const entry of handlers) {
        // Skip once-handlers that were already removed during emission
        if (entry._removed) continue;

        try {
          entry.handler(payload, rootCtx);
        } catch (err) {
          const wrapped = this._wrapError(err, eventName, phase, entry);
          if (entry.role === "observer") {
            // Observer failure must not abort the authoritative transaction
            rootCtx.observerErrors.push(wrapped);
          } else {
            throw wrapped;
          }
        } finally {
          // A once-handler is consumed by its attempted invocation, including
          // a failed one, so retries cannot repeat a partial side effect.
          if (entry.once && !entry._removed) {
            entry._removed = true;
            this._removeEntry(eventName, entry);
          }
        }
      }
    }

    return {
      cancelled: rootCtx._cancelled,
      reason: rootCtx._cancelReason,
      finalPayload: payload,
      children: rootCtx._children,
      observerErrors: rootCtx.observerErrors,
    };
  }

  /** @private */
  _emitSinglePhase(eventName, payload, phase) {
    const ctx = new EventContext(this, eventName, normalizePhase(phase), 0);
    const handlers = this._collectHandlers(eventName, normalizePhase(phase));

    for (const entry of handlers) {
      if (ctx._cancelled) break;
      if (entry._removed) continue;

      try {
        entry.handler(payload, ctx);
      } catch (err) {
        const wrapped = this._wrapError(err, eventName, phase, entry);
        if (entry.role === "observer") {
          ctx.observerErrors.push(wrapped);
        } else {
          throw wrapped;
        }
      } finally {
        if (entry.once && !entry._removed) {
          entry._removed = true;
          this._removeEntry(eventName, entry);
        }
      }
    }

    return {
      cancelled: ctx._cancelled,
      reason: ctx._cancelReason,
      modifiedPayload: payload,
      children: ctx._children,
      observerErrors: ctx.observerErrors,
    };
  }

  /** @private */
  _collectHandlers(eventName, phase) {
    const result = [];

    // Direct handlers
    const direct = this._listeners.get(eventName);
    if (direct) {
      for (const e of direct) {
        if (e.phase === phase) result.push(e);
      }
    }

    // Wildcard handlers
    if (eventName !== "*") {
      const wild = this._listeners.get("*");
      if (wild) {
        for (const e of wild) {
          if (e.phase === phase) result.push(e);
        }
      }
    }

    // Stable sort by [priority, sourceAge, registrationOrder]
    result.sort((a, b) => sortKey(a) - sortKey(b));
    return result;
  }

  /** @private */
  _createEntry(eventName, handler, options) {
    const phase = normalizePhase(options.phase);
    const priority = options.priority ?? 0;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      throw new Error("Event handler priority must be a finite number");
    }

    return {
      eventName,
      handler,
      phase,
      priority,
      sourceAge: options.sourceAge ?? this._clock.now(),
      order: this._registrationOrder++,
      once: false,
      role: normalizeRole(options.role),
      _removed: false,
    };
  }

  /** @private */
  _removeEntry(eventName, entry) {
    const list = this._listeners.get(eventName);
    if (!list) return;

    const idx = list.indexOf(entry);
    if (idx === -1) return;

    list.splice(idx, 1);
    if (list.length === 0) this._listeners.delete(eventName);
  }

  /** @private */
  _wrapError(err, eventName, phase, entry) {
    const label = entry.handler?.name || "(anonymous)";
    const wrapped = new Error(
      `[${eventName}:${phase}] handler "${label}" threw: ${err.message}`
    );
    wrapped.cause = err;
    wrapped.eventName = eventName;
    wrapped.phase = phase;
    wrapped.handlerName = label;
    return wrapped;
  }
}
