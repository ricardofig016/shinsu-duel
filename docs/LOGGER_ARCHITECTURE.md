# Logger Architecture — Shinsu Duel

This document describes the full-state-diff logger that captures event
causation trees and state transitions for debugging, replay, and auditing.

---

## Overview

The Logger hooks into the EventBus to capture **before/after snapshots**
of game state for every root event, along with the full **causation tree**
from DFS event resolution. This enables:

- **Replay**: given the initial state and log, replay every event.
- **Debugging**: see exactly what changed and which event caused it.
- **Auditing**: trace the full chain from action → effect → cascade.

| Feature | Implementation |
|---|---|
| State snapshots | `snapshotFn()` called before and after each root event |
| Causation trees | `ctx._children` from DFS resolution |
| Pluggable backends | `MemoryBackend`, `ConsoleBackend`, custom |
| Diff computation | Added/removed/changed keys between snapshots |

---

## How It Hooks the EventBus

The Logger uses **three subscriptions** on the wildcard `"*"` event:

```
Phase "pre",      priority -9999  → snapshot state BEFORE any handler runs
Phase "pre",      priority  9999  → capture CANCELLED events (they never reach resolved)
Phase "resolved", priority  9999  → capture COMPLETED events and write entry
```

**Why two capture points?** Cancelled events skip all remaining phases
(including `resolved`). The `pre` priority-9999 hook catches them right
after the cancellation takes effect. Non-cancelled events are captured
in `resolved` for consistency.

**Why priority -9999 for the snapshot?** The snapshot MUST run before any
handler modifies state — otherwise the "before" snapshot is wrong.

**Why priority 9999 for the writes?** The write MUST run after all other
handlers in that phase — otherwise the "after" snapshot misses mutations.

---

## Log Entry Structure

```js
{
  id: 42,
  timestamp: "2026-08-01T22:00:00.000Z",
  rootEvent: "unit:damage:intent",
  cancelled: false,
  cancelReason: null,
  causationTree: {
    eventName: "unit:damage:intent",
    cancelled: false,
    children: [
      {
        eventName: "unit:killed",
        cancelled: false,
        children: [
          { eventName: "unit:slay",    cancelled: false, children: [] },
          { eventName: "card:draw",    cancelled: false, children: [] }
        ]
      },
      {
        eventName: "modifier:trait:granted",  // from Bloodthirsty trigger
        cancelled: false,
        children: []
      }
    ]
  },
  stateBefore: {
    "Alice.frontline.Unit#a3f.hp": 3,
    "Alice.handSize": 5,
    "Bob.lighthouses": 15
  },
  stateAfter: {
    "Alice.frontline.Unit#a3f.hp": 0,    // killed
    "Alice.handSize": 6,                  // drew from Slay
    "Bob.lighthouses": 14                 // lost 1 from Pierce
  },
  diff: {
    added:   [{ key: "Alice.handSize", value: 6 }],
    removed: [{ key: "Alice.frontline.Unit#a3f.hp" }],
    changed: [{ key: "Bob.lighthouses", old: 15, new: 14 }]
  }
}
```

### Causation tree depth

The tree currently captures **3 levels**: root → children → grandchildren.
Deeper nesting is flattened (grandchildren's children are omitted).
This is a pragmatic limit — most game event chains are 2-3 levels deep.

**⚠️ If Phase 2+ introduces deeper chains, extend `_buildCausationTree`**
to recurse fully instead of hardcoding 3 levels.

---

## Backend System

```js
class MemoryBackend {
  write(entry)  // push to this.logs[]
  getAll()      // return copy
  clear()       // empty
}

class ConsoleBackend {
  write(entry)  // console.log with diff formatting
  getAll()      // return [] (console has no retrieval)
  clear()       // no-op
}
```

**Adding a custom backend:**
```js
class FileBackend {
  constructor(filepath) { this.path = filepath; }
  write(entry) { fs.appendFileSync(this.path, JSON.stringify(entry) + "\n"); }
  getAll() { /* read and parse file */ }
  clear() { fs.writeFileSync(this.path, ""); }
}

logger.addBackend(new FileBackend("./logs/game-42.jsonl"));
```

**⚠️ Backends receive the entry object by reference.** If a backend mutates
the entry, subsequent backends see the mutated version. Always copy if you
need to transform.

---

## Snapshot Function

The Logger receives a `snapshotFn` from the caller. In production, this is
`GameState._createSnapshot()`. The snapshot function must be:

1. **Synchronous** — it's called inside event handlers.
2. **Deterministic** — same state must produce same snapshot.
3. **Cheap** — it runs on every root event (potentially hundreds per turn).

The current `GameState._createSnapshot()` returns:
```js
{
  round: 3,
  currentTurn: "Alice",
  Alice: {
    lighthouses: 18,
    shinsu: { normalSpent: 2, normalAvailable: 4, recharged: 1 },
    handSize: 5,
    deckSize: 20,
    frontline: [{ id, name, hp, position }, ...],
    backline:  [{ id, name, hp, position }, ...]
  },
  Bob: { /* same structure */ }
}
```

**⚠️ This snapshot does NOT include modifier state** (traits granted by
equipment, active conditions). Extend it in Phase 2 to capture these so
diffs reflect trait/condition changes.

---

## Diff Algorithm

```js
_computeDiff(before, after) {
  // All keys in either snapshot
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);

  for (const key of allKeys) {
    if (before[key] === undefined && after[key] !== undefined)
      → added
    else if (before[key] !== undefined && after[key] === undefined)
      → removed
    else if (JSON.stringify(before[key]) !== JSON.stringify(after[key]))
      → changed { key, old, new }
  }
}
```

**⚠️ Uses `JSON.stringify` for deep comparison.** This works for the flat
key structure but would be expensive with deeply nested objects. If Phase 2
adds nested snapshot values, switch to a structural diff.

**⚠️ Keys are flat strings like `"Alice.frontline.Unit#a3f.hp"`.** The
snapshot function controls the key namespace. Keep keys consistent between
before/after snapshots.

---

## Public API

```js
const logger = new Logger(eventBus, {
  debug: false,                          // enable ConsoleBackend
  snapshotFn: () => gameState.snapshot() // state capture function
});

logger.getLogs();     // → Array of log entries (from MemoryBackend)
logger.clear();       // → empty all backends
logger.addBackend(b); // → register custom backend
```

---

## Integration with Phase 2+

### What Phase 2 must do

1. **Extend `_createSnapshot()`** to include modifier state (active traits,
   conditions, stat modifiers) so diffs capture equipment/cleanse/silence
   changes.

2. **Extend `_buildCausationTree()`** to recurse fully instead of
   hardcoding 3 levels, if Phase 2 introduces deeper event chains.

3. **Add a `FileBackend`** for production use — memory logs grow unbounded
   and crash the server on long games.

### Anti-patterns

- **Don't mutate `getLogs()` return value** — it's a shallow copy.
- **Don't call `getLogs()` in hot paths** — it copies the entire array.
- **Don't add expensive work to `snapshotFn`** — it runs synchronously
  inside event handlers.
