/**
 * Full-state-diff logger for Shinsu Duel.
 *
 * Captures state snapshots before and after each root event, computes diffs,
 * and records causation trees (parent→child event chains from DFS resolution).
 *
 * ## Log entry structure
 *
 *   {
 *     id:            incrementing number,
 *     timestamp:     ISO string,
 *     rootEvent:     event name,
 *     causationTree: nested { eventName, children: [...] },
 *     stateBefore:   snapshot,
 *     stateAfter:    snapshot,
 *     diff:          { added: [], removed: [], changed: [] }
 *   }
 *
 * ## Backends
 *
 * The logger supports pluggable backends. Built-in:
 *  - MemoryBackend (default): stores logs in memory, accessible via getLogs().
 *  - ConsoleBackend: prints to console in debug mode.
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
    const ts = entry.timestamp;
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
   * @param {Function} [options.snapshotFn]  Function that returns current state snapshot.
   */
  constructor(eventBus, options = {}) {
    this._bus = eventBus;
    this._debug = options.debug ?? false;
    this._snapshotFn = options.snapshotFn ?? (() => ({}));
    this._idCounter = 0;

    /** @type {Array<MemoryBackend|ConsoleBackend>} */
    this._backends = [new MemoryBackend()];
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
    this._backends.push(backend);
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  _subscribe() {
    // Snapshot FIRST (priority -9999) so we capture state before any handler runs
    this._bus.on("*", (payload, ctx) => {
      if (ctx.depth === 0) {
        this._pendingSnapshot = this._snapshotFn();
      }
    }, { phase: "pre", priority: -9999 });

    // Record LAST in pre phase (priority 9999) for cancelled events.
    // CANCELLED events never reach resolved, so we record here.
    this._bus.on("*", (payload, ctx) => {
      if (ctx.depth !== 0) return;
      if (!ctx._cancelled) return; // only cancelled events

      const stateAfter = this._snapshotFn();
      const stateBefore = this._pendingSnapshot ?? {};
      this._pendingSnapshot = null;
      this._writeEntry(ctx, stateBefore, stateAfter);
    }, { phase: "pre", priority: 9999 });

    // Record in resolved phase for non-cancelled events
    this._bus.on("*", (payload, ctx) => {
      if (ctx.depth !== 0) return;

      const stateAfter = this._snapshotFn();
      const stateBefore = this._pendingSnapshot ?? {};
      this._pendingSnapshot = null;
      this._writeEntry(ctx, stateBefore, stateAfter);
    }, { phase: "resolved", priority: 9999 });
  }

  _writeEntry(ctx, stateBefore, stateAfter) {
    const diff = this._computeDiff(stateBefore, stateAfter);
    const tree = this._buildCausationTree(ctx);

    const entry = {
      id: ++this._idCounter,
      timestamp: new Date().toISOString(),
      rootEvent: ctx.eventName,
      cancelled: ctx.cancelled,
      cancelReason: ctx._cancelReason,
      causationTree: tree,
      stateBefore,
      stateAfter,
      diff,
    };

    for (const backend of this._backends) {
      backend.write(entry);
    }
  }

  _buildCausationTree(ctx) {
    return {
      eventName: ctx.eventName,
      cancelled: ctx.cancelled,
      children: (ctx._children || []).map((c) => ({
        eventName: c.eventName,
        cancelled: c.result?.cancelled ?? false,
        children: (c.result?.children || []).map((gc) => ({
          eventName: gc.eventName,
          cancelled: gc.result?.cancelled ?? false,
          children: [],
        })),
      })),
    };
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
