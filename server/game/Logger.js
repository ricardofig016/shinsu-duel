/**
 * Full-state-diff logger for Shinsu Duel.
 *
 * Captures state snapshots before and after each root event, computes diffs,
 * and records causation trees (parent→child event chains from DFS resolution).
 * Also records the authoritative player-input stream with full deterministic
 * state so games can be replayed via ReplayDriver.
 *
 * ## Log entry structure
 *
 *   {
 *     id:              incrementing number,
 *     sequence:        deterministic sequence (= id),
 *     rootEvent:       event name,
 *     originalPayload: payload cloned before handlers mutated it,
 *     causationTree:   nested { eventName, children: [...] },
 *     stateBefore:     snapshot,
 *     stateAfter:      snapshot,
 *     diff:            { added: [], removed: [], changed: [] }
 *   }
 *
 * ## Backends
 *
 * The logger supports pluggable backends. Built-in:
 *  - MemoryBackend (default): stores logs in memory, accessible via getLogs().
 *  - ConsoleBackend: prints to console in debug mode.
 *
 * Additional backends can be attached at construction (`options.backends`, so
 * they observe every entry including InitialState) or later via addBackend().
 * A backend that throws during write is reported and skipped; it never
 * interrupts the game loop.
 */

// ---------------------------------------------------------------------------
// Backends
// ---------------------------------------------------------------------------

class MemoryBackend {
  constructor() {
    this.logs = [];
  }
  write(entry) {
    this.logs.push(entry);
  }
  getAll() {
    return [...this.logs];
  }
  clear() {
    this.logs = [];
  }
}

class ConsoleBackend {
  write(entry) {
    const ts = new Date().toISOString();
    const event = entry.rootEvent;
    const cancelled = entry.cancelled ? " [CANCELLED]" : "";
    console.log(`[${ts}] ${event}${cancelled}`);
    if (entry.diff) {
      const { added, removed, changed } = entry.diff;
      if (added.length) console.log(`  + ${added.map(d => `${d.key}=${d.value}`).join(", ")}`);
      if (removed.length) console.log(`  - ${removed.map(d => d.key).join(", ")}`);
      if (changed.length) console.log(`  ~ ${changed.map(d => `${d.key}: ${d.old}→${d.new}`).join(", ")}`);
    }
  }
  getAll() { return []; }
  clear() {}
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export default class Logger {
  /**
   * @param {import('./EventBus.js').default} eventBus
   * @param {object} [options]
   * @param {boolean} [options.debug=false]  Enable console output.
   * @param {Function} [options.snapshotFn]  Function that returns the flat state snapshot.
   * @param {Function} [options.serializeFn]  Function that returns the full deterministic state.
   * @param {Array} [options.backends]  Backends attached at construction so they
   *   observe every entry, including InitialState (written by the game's constructor).
   */
  constructor(eventBus, options = {}) {
    this._bus = eventBus;
    this._debug = options.debug ?? false;
    this._snapshotFn = options.snapshotFn ?? (() => ({}));
    this._serializeFn = options.serializeFn ?? (() => ({}));
    this._idCounter = 0;
    this._pendingSnapshot = null;
    this._pendingOriginalPayload = null;
    this._pendingUserInput = null;

    /** @type {Array<MemoryBackend|ConsoleBackend>} */
    this._backends = [new MemoryBackend()];
    for (const backend of options.backends ?? []) this._addBackend(backend);
    if (this._debug) this._backends.push(new ConsoleBackend());

    this._subscribe();
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** @returns {Array<object>} All log entries. */
  getLogs() {
    return this._backends.find((b) => b instanceof MemoryBackend)?.getAll() ?? [];
  }

  /** Clear all logs. */
  clear() {
    for (const b of this._backends) b.clear();
  }

  /** Add a custom backend. */
  addBackend(backend) {
    this._addBackend(backend);
  }

  _addBackend(backend) {
    if (!backend || typeof backend.write !== "function" || typeof backend.getAll !== "function" || typeof backend.clear !== "function") {
      throw new TypeError("A logger backend must implement write(entry), getAll(), and clear().");
    }
    this._backends.push(backend);
  }

  /**
   * Record the initial game state and construction metadata. Called by
   * GameState at the end of its constructor (before the initial events).
   *
   * @param {object} meta { roomCode, usernames, decks, firstPlayer, rngSeed }
   */
  recordInitialState(meta) {
    this._write({
      type: "InitialState",
      sequence: ++this._idCounter,
      meta,
      state: this._serializeFn(),
    });
  }

  /**
   * Mark the start of a player input (action or decision) and capture the
   * full state before it is applied.
   *
   * @param {{ kind: "action"|"decision", payload: object }} input
   */
  beginUserInput({ kind, payload }) {
    this._pendingUserInput = { kind, payload, stateBefore: this._serializeFn() };
  }

  /**
   * Mark the end of the current player input, capturing the full state after.
   *
   * @param {{ ok?: boolean, error?: Error|null }} result
   */
  endUserInput({ ok = true, error = null } = {}) {
    const ui = this._pendingUserInput;
    this._pendingUserInput = null;
    if (!ui) return;

    const isAction = ui.kind === "action";
    this._write({
      type: isAction ? "UserAction" : "UserDecision",
      sequence: ++this._idCounter,
      [isAction ? "action" : "decision"]: ui.payload,
      stateBefore: ui.stateBefore,
      stateAfter: this._serializeFn(),
      ok,
      error: error ? { name: error.name, message: error.message, stack: error.stack } : null,
    });
  }

  /**
   * @returns {{ initial: object|null, actions: Array<object> }} A JSON-safe
   *   replay log: the initial state plus the ordered player inputs.
   */
  getReplayLog() {
    const logs = this.getLogs();
    const initial = logs.find((l) => l.type === "InitialState") ?? null;
    const actions = logs.filter((l) => l.type === "UserAction" || l.type === "UserDecision");
    return this._safeClone({ initial, actions });
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _subscribe() {
    // Snapshot FIRST (priority -9999) so we capture state and payload before
    // any handler runs or mutates them.
    this._bus.on("*", (payload, ctx) => {
      if (ctx.depth === 0) {
        this._pendingSnapshot = this._snapshotFn();
        this._pendingOriginalPayload = this._safeClone(payload);
      }
    }, { phase: "pre", priority: -9999, role: "observer" });

    // Record LAST in pre phase (priority 9999) for cancelled events.
    // CANCELLED events never reach resolved, so we record here.
    this._bus.on("*", (payload, ctx) => {
      if (ctx.depth !== 0) return;
      if (!ctx._cancelled) return; // only cancelled events

      const stateAfter = this._snapshotFn();
      const stateBefore = this._pendingSnapshot ?? {};
      this._pendingSnapshot = null;
      this._writeEntry(ctx, stateBefore, stateAfter);
    }, { phase: "pre", priority: 9999, role: "observer" });

    // Record in resolved phase for non-cancelled events
    this._bus.on("*", (payload, ctx) => {
      if (ctx.depth !== 0) return;

      const stateAfter = this._snapshotFn();
      const stateBefore = this._pendingSnapshot ?? {};
      this._pendingSnapshot = null;
      this._writeEntry(ctx, stateBefore, stateAfter);
    }, { phase: "resolved", priority: 9999, role: "observer" });

    // Record authoritative failures that abort a transaction.
    this._bus.onAbort((wrapped, info) => {
      this._write({
        type: "EventFailure",
        sequence: ++this._idCounter,
        eventName: info.eventName,
        phase: info.phase,
        handlerName: info.handlerName,
        error: { name: wrapped.name, message: wrapped.message },
        stateBefore: this._pendingSnapshot ?? null,
        stateAfter: this._snapshotFn(),
      });
    });
  }

  _writeEntry(ctx, stateBefore, stateAfter) {
    const diff = this._computeDiff(stateBefore, stateAfter);
    const tree = this._buildCausationTree(ctx);

    const entry = {
      id: ++this._idCounter,
      sequence: this._idCounter,
      rootEvent: ctx.eventName,
      cancelled: ctx.cancelled,
      cancelReason: ctx._cancelReason,
      causationTree: tree,
      originalPayload: this._pendingOriginalPayload,
      stateBefore,
      stateAfter,
      diff,
    };
    this._pendingOriginalPayload = null;
    this._write(entry);
  }

  _write(entry) {
    // Backends run synchronously inside the engine loop; one failing backend
    // (e.g. a disk error) must never break gameplay or starve the others.
    for (const backend of this._backends) {
      try {
        backend.write(entry);
      } catch (error) {
        console.error(`Logger: backend ${backend.constructor?.name ?? "anonymous"} failed to write entry ${entry?.sequence}:`, error);
      }
    }
  }

  _buildCausationTree(ctx) {
    const node = (eventName, cancelled, childRecords) => ({
      eventName,
      cancelled,
      children: (childRecords || []).map((c) =>
        node(c.eventName, c.result?.cancelled ?? false, c.result?.children)
      ),
    });
    return node(ctx.eventName, ctx.cancelled, ctx._children);
  }

  _safeClone(value) {
    try {
      return structuredClone(value);
    } catch {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
  }

  _computeDiff(before, after) {
    const added = [];
    const removed = [];
    const changed = [];

    const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

    for (const key of allKeys) {
      const bVal = before[key];
      const aVal = after[key];

      if (bVal === undefined && aVal !== undefined) {
        added.push({ key, value: aVal });
      } else if (bVal !== undefined && aVal === undefined) {
        removed.push({ key });
      } else if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
        changed.push({ key, old: bVal, new: aVal });
      }
    }

    return { added, removed, changed };
  }
}
