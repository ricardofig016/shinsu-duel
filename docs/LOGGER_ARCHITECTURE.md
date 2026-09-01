# Logger Architecture — Shinsu Duel

This document describes the full-state-diff logger that captures event causation trees and state transitions for debugging, replay, and auditing.

---

## Overview

The Logger hooks into the EventBus to capture **before/after snapshots** of game state for every root event, along with the full **causation tree** from DFS event resolution. It also records the authoritative player-input stream (`processAction` / `resolveDecision`) with the full deterministic state on each side, enabling faithful **action-level replay**. This enables:

- **Replay**: given the initial state and the recorded action stream, `ReplayDriver` reconstructs the game and verifies every step byte-for-byte.
- **Debugging**: see exactly what changed and which event caused it.
- **Auditing**: trace the full chain from action → effect → cascade.

| Feature            | Implementation                                                 |
| ------------------ | -------------------------------------------------------------- |
| State snapshots    | `snapshotFn()` (flat diff view) + `serializeFn()` (full state) |
| Causation trees    | `ctx._children` from DFS resolution (full depth)               |
| Pluggable backends | `MemoryBackend`, `ConsoleBackend`, `GameFileLogger`, custom    |
| Diff computation   | Added/removed/changed keys between snapshots                   |
| Replay log         | `recordInitialState` + `begin/endUserInput` → `getReplayLog()` |
| Live file capture  | `GameFileLogger` for `TESTROOM*` rooms (see Live dev logging)  |

---

## How It Hooks the EventBus

The Logger uses **three subscriptions** on the wildcard `"*"` event:

```
Phase "pre",      priority -9999  → snapshot state BEFORE any handler runs
Phase "pre",      priority  9999  → capture CANCELLED events (they never reach resolved)
Phase "resolved", priority  9999  → capture COMPLETED events and write entry
```

**Why two capture points?** Cancelled events skip all remaining phases (including `resolved`). The `pre` priority-9999 hook catches them right after the cancellation takes effect. Non-cancelled events are captured in `resolved` for consistency.

**Why priority -9999 for the snapshot?** The snapshot MUST run before any handler modifies state — otherwise the "before" snapshot is wrong.

**Why priority 9999 for the writes?** The write MUST run after all other handlers in that phase — otherwise the "after" snapshot misses mutations.

---

## Log Entry Structure

```js
{
  id: 42,
  sequence: 42,
  rootEvent: "unit:damage:intent",
  cancelled: false,
  cancelReason: null,
  originalPayload: { /* deep-cloned payload BEFORE handlers mutate it */ },
  causationTree: {
    eventName: "unit:damage:intent",
    cancelled: false,
    children: [
      {
        eventName: "unit:killed",
        cancelled: false,
        children: [
          { eventName: "unit:destroyed", cancelled: false, children: [] },
          { eventName: "card:drawn",    cancelled: false, children: [] }
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

The tree is fully recursive: `_buildCausationTree` follows `ctx._children` arbitrarily deep, so arbitrarily nested DFS event chains are captured in full.

### Entry types

In addition to root-event entries (shown above), the Logger writes:

- `InitialState` — the reconstructed construction metadata (decks, first player, RNG seed, RNG position, starting ID counters) plus the full serialized state.
- `UserAction` / `UserDecision` — one entry per `processAction` / `resolveDecision`, with the input payload, a deep `diff` against the previous recorded state (`{ changed: { "<dotted.path>": value }, removed: ["<dotted.path>"] }`, computed by `utils/stateDiff.js`), `ok`, and `error` (for failed inputs — whose diff is empty, proving no mutation). The artifact never stores a full per-step state: the diff base is the `InitialState` state or the prior entry's, so each change is stored exactly once.
- `EventFailure` — written via `EventBus.onAbort` when an authoritative handler failure aborts a transaction.

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

class GameFileLogger {
  write(entry)  // append replay entries to the JSONL stream; skip others
  getAll()      // return [] (files are the retrieval)
  clear()       // no-op
}
```

**Adding a custom backend:** backends can be attached at construction — `new Logger(bus, { backends: [...] })` — so they observe every entry, including `InitialState` (written by the game's constructor, before any handler runs). Backends attached later via `addBackend(...)` see everything from that point on. A backend whose `write` throws is reported via `console.error` and skipped; it never breaks the game loop or starves the other backends.

```js
class FileBackend {
  constructor(filepath) {
    this.path = filepath;
  }
  write(entry) {
    fs.appendFileSync(this.path, JSON.stringify(entry) + "\n");
  }
  getAll() {
    /* read and parse file */
  }
  clear() {
    fs.writeFileSync(this.path, "");
  }
}

logger.addBackend(new FileBackend("./logs/game-42.jsonl"));
```

**⚠️ Backends receive the entry object by reference.** If a backend mutates the entry, subsequent backends see the mutated version. Always copy if you need to transform.

---

## Live dev logging

`GameFileLogger` (in `server/game/logging/GameFileLogger.js`) is the built-in file backend for debugging a live game. It is wired into the production game factory: `createGameServer` attaches one to every game whose **room code matches `TESTROOM` followed by digits** (e.g. `TESTROOM01`). Rooms with any other code never touch the disk.

Each matching session writes one JSONL file into `gameLogDirectory` (default `server/logs/games`), named `<roomCode>.<startedAt>.replay.jsonl`:

- **replay stream** — the `InitialState` entry plus every `UserAction` / `UserDecision` entry (failed inputs included): the exact input `ReplayDriver.replay()` consumes. User-input entries carry the input, a deep diff against the previous recorded state, `ok`, and `error`; a pass-turn line is typically ~100–200 characters, a full state appears only once (the `InitialState` line).

Root-event and `EventFailure` entries are deliberately **not** persisted: the engine is deterministic, so replaying the artifact regenerates the complete events view (before/after snapshots, diffs, causation trees, authoritative failures) in the reconstructed game's own logger — `replayed.logger.getLogs()`. Persisting them would duplicate information the replay stream already determines.

Guarantees:

- **Entries are serialized eagerly at write time.** Snapshots alias live game state, so deferring `JSON.stringify` would capture mutated values.
- **Writes never throw.** A disk failure is reported via `console.error` and gameplay continues; a game whose log directory cannot even be created fails loudly at game creation (the gateway reports it to the players); an entry that cannot be serialized writes a loud placeholder line instead of being dropped silently.
- **The file is append-only and created on its first replay write.** Each write is a synchronous append, so a hard crash loses at most the line being written.

**To watch a live game:** add a room record whose code is `TESTROOM` followed by digits to `server/data/rooms.json` (e.g. `"TESTROOM01": { "players": [], "opponent": "friend", "difficulty": null, "seed": 1 }`), then log both seats in through the normal join flow. The file appears under `server/logs/games/` the moment the game starts. To reconstruct the game at any point, read the newest `replay.jsonl` back: parse each line as JSON, take the `InitialState` entry as `initial` and the `UserAction`/`UserDecision` entries in file order as `actions`, then call `ReplayDriver.replay({ initial, actions })`; call `replayed.logger.getLogs()` on the result for the full events view.

---

## Snapshot Function

The Logger receives two capture functions from the caller. In production (`GameState`), these are `_createSnapshot()` and `toSerializedState()`.

1. **`snapshotFn`** — the flat, cheap diff view (`GameState._createSnapshot()`). Called before/after every root event. Used for the `diff` field.
2. **`serializeFn`** — the complete deterministic serialization (`GameState.toSerializedState()`). Used for `InitialState`, `UserAction`, `UserDecision`, and `EventFailure` entries. This is what makes replay possible.

Both must be **synchronous**, **deterministic** (same state → same output), and the flat view must stay **cheap** (it runs on every root event).

The flat `GameState._createSnapshot()` returns:

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

**⚠️ Uses `JSON.stringify` for deep comparison.** This works for the flat key structure but would be expensive with deeply nested objects. If snapshot values become deeply nested, switch to a structural diff.

**⚠️ Keys are flat strings like `"Alice.frontline.Unit#a3f.hp"`.** The snapshot function controls the key namespace. Keep keys consistent between before/after snapshots.

---

## Public API

```js
const logger = new Logger(eventBus, {
  debug: false, // enable ConsoleBackend
  snapshotFn: () => gameState._createSnapshot(), // flat diff view
  serializeFn: () => gameState.toSerializedState(), // full deterministic state
});

logger.recordInitialState(meta); // called by GameState's constructor
logger.beginUserInput({ kind: "action", payload }); // called by processAction
logger.endUserInput({ ok, error }); // called after the action resolves

logger.getLogs(); // → Array of log entries (from MemoryBackend)
logger.getReplayLog(); // → { initial, actions } JSON-safe replay log
logger.clear(); // → empty all backends
logger.addBackend(b); // → register custom backend
```

## Replay

`ReplayDriver.replay(replayLog)` restores the recorded ID/modifier counters **and the recorded RNG position** (`initial.meta.rngState`), reconstructs `GameState` from the `InitialState` metadata (decks, first player, seeded RNG), verifies the initial serialization, then re-applies each `UserAction`/`UserDecision` while stepping an in-memory expected state forward with each recorded diff (`utils/stateDiff.js` `applyStateDiff`) — asserting the **full** serialized state matches after every step. The artifact stores only per-step diffs, so verification stays byte-for-byte while the file stays small; legacy artifacts that stored a full `stateAfter` per entry are rejected loudly.

Replay requires a **seeded RNG**. Every game is constructed with a `SeededRng`. `gameFactory` turns a room's persisted seed into the seeded first-player roll and shuffled default decks, then passes them explicitly to `GameState`. Deck building consumes RNG draws before the constructor runs, which is why the driver restores `meta.rngState` — the exact `{ seed, calls }` position captured alongside the initial state — before reconstructing, so subsequent draws stay aligned with the log.

---

## Anti-patterns

- **Don't mutate `getLogs()` return value** — it's a shallow copy.
- **Don't call `getLogs()` in hot paths** — it copies the entire array.
- **Don't add expensive work to `snapshotFn`** — it runs synchronously inside event handlers.
