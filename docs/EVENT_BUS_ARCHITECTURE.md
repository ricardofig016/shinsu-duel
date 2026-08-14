# EventBus Architecture — Shinsu Duel

This document describes the architecture, design decisions, and usage patterns for the Shinsu Duel event system.

---

## Overview

The event system has four core components:

| Component         | File                           | Purpose                                             |
| ----------------- | ------------------------------ | --------------------------------------------------- |
| **GameClock**     | `server/game/GameClock.js`     | Shared monotonic counter for deterministic ordering |
| **EventBus**      | `server/game/EventBus.js`      | DFS event dispatch engine                           |
| **ModifierStack** | `server/game/ModifierStack.js` | Provenance-tracked state modifier storage           |
| **Logger**        | `server/game/Logger.js`        | Full-state-diff event logger                        |

---

## EventBus

### Why DFS over BFS?

When an event handler triggers a child event, the child **fully resolves** (all 4 phases + any grandchildren) before the next handler at the parent level runs. This preserves causality — you see one chain complete before another begins.

**Example:** Damage → Kill → Destroy → Draw

```
emit("unit:damage:intent")
  pre:    (Barrier reduces damage)
  execute: unit takes damage
  post:
    handler A: checks kill → emitChild("unit:killed")
      pre:    ...
      execute: unit dies
      post:   Slay trigger fires (subscribed to unit:killed)
      resolved: ...
    handler B: emitChild("unit:destroyed")
      pre:    ...
      execute: unit removed from field
      post:   on-death trigger → emitChild("card:drawn")
      resolved: ...
    handler C: (runs AFTER the entire kill chain completes)
  resolved: logging
```

With BFS, all post handlers would run first, then all kill handlers, then all destroy handlers — the causality chain is lost.

### Four Phases

| Phase      | Purpose                               | Can cancel? | Can emitChild? |
| ---------- | ------------------------------------- | ----------- | -------------- |
| `pre`      | Modify payload, validate, cancel      | Yes         | Yes            |
| `execute`  | Main state mutation                   | Yes         | Yes            |
| `post`     | Reactions (when damaged, when killed) | No          | Yes            |
| `resolved` | Logging, cleanup                      | No          | No             |

**Phase transition rule:** When any handler calls `context.cancel()`, the current phase finishes (all handlers in that phase still run), then remaining phases are skipped.

### Deterministic Ordering

Within a phase, handlers run in this order:

1. **Priority** (ascending — lower runs first)
2. **Source age** (ascending — older sources run first)
3. **Registration order** (ascending — first registered runs first)

**Why source age?** If Unit A (deployed round 1) and Unit B (deployed round 3) both have "round end" passives, Unit A fires first because it's been waiting longer. This is more intuitive and deterministic.

### API

```js
const clock = new GameClock();
const bus = new EventBus(clock, (maxDepth = 50));

// Register
const unsub = bus.on(
  "event:name",
  (payload, ctx) => {
    // payload is mutated in-place
    // ctx.emitChild("child:event", childPayload);  // DFS child
    // ctx.cancel("reason");                        // cancel event
  },
  {
    phase: "execute",
    priority: 0,
    sourceAge: clock.now(),
    role: "authoritative",
  },
);

// Read-only observers (logging, telemetry) must be registered as such so their
// failures are isolated and never abort the authoritative transaction.
bus.on("event:name", observer, { role: "observer" });

// One-shot
bus.once("event:name", handler, options);

// Remove
bus.off("event:name", handler);
bus.removeAllListeners("event:name");
bus.removeAllListeners(); // clear all

// Emit
const result = bus.emit("event:name", payload);
// result: { cancelled, reason, finalPayload, children, observerErrors }
```

### Handler Roles

Every handler is classified at registration via `options.role`:

| Role            | Default | On failure                                                                 |
| --------------- | ------- | -------------------------------------------------------------------------- |
| `authoritative` | ✅      | Abort the whole event transaction and rethrow to the original caller       |
| `observer`      | —       | Isolate the error, record it in `result.observerErrors`, continue dispatch |

Authoritative handlers perform transactional state mutations. Observers are read-only (logging, telemetry, replay) and must never mutate authoritative state, which is what makes their failure safe to isolate.

### Failure Handling

An **authoritative** failure is **fail-closed**: dispatch stops immediately at the exact deterministic point (priority, source age, registration order) and the wrapped exception is rethrown. This prevents later handlers from applying additional mutations or reactions after an authoritative handler has failed. Completed state changes are not rolled back, so mutation handlers must validate all inputs before writing state. Each error identifies:

- Event name
- Phase
- Handler identity (function name)

An **observer** failure never aborts the transaction. The wrapped error is appended to the emit result's `observerErrors` array (with the same event, phase, and handler metadata) and dispatch continues to the next handler.

### Abort Notification

`bus.onAbort(fn)` registers a callback invoked immediately before an authoritative failure is rethrown, with `(error, { eventName, phase, handlerName, ctx })`. The `Logger` uses this to record failed and partially-resolved event chains (`EventFailure` entries). A throwing abort listener never masks the original error. Observer failures do **not** trigger `onAbort`.

### Transaction Boundary

A root `emit()` is a single transaction. Every `emitChild` chain spawned during its resolution belongs to the same transaction: an authoritative failure anywhere in the DFS chain aborts the entire transaction and propagates to the root caller. Observer failures are isolated to the event whose dispatch they belong to — an observer failure in a child event is reported on the child's result, not the root's. Cancellation and failure ordering are deterministic for identical inputs.

The built-in `Logger` registers its wildcard subscriptions as observers, so a logging or snapshot failure never corrupts the game state it observes.

### Recursion Guard

The `maxDepth` parameter (default 50) prevents infinite event loops. If a handler chain exceeds this depth, a descriptive error is thrown.

---

## ModifierStack

### Why provenance tracking?

The `ModifierStack` solves the class of problems where effects need to be **reversible** based on their source. The canonical example:

**Equipment grants trait → Silence disables it → Unequip removes source → Unsilence should NOT restore the trait.**

Without source tracking, you'd need to manually track "who gave what to whom" and risk creating negative stats (e.g., removing Barrier when it was already removed by Silence).

### Modifier structure

```js
{
  id:         "mod_42",        // unique
  sourceId:   "Equip#17",      // who created this modifier
  sourceType: "equipment",     // equipment | unit | skill | passive | landmark | system
  targetId:   "Unit#8",        // who receives this modifier
  type:       "trait",         // trait | condition | stat | ability | keyword
  key:        "barrier",       // what is being modified
  value:      1,               // how much
  operation:  "add",           // add | set | override
  enabled:    true,            // Silence flips to false
  createdAt:  42,              // clock tick for tiebreaking
}
```

### Key operations

```js
stack.apply(spec); // Add a modifier, emits grant event
stack.removeBySource(sourceId); // Unequip, unit death — removes all from source
stack.removeByTarget(targetId); // Unit destroyed — removes all on target
stack.removeWhere(predicate); // Cleanse — removes conditions only
stack.disableByTarget(id, type); // Silence — flips enabled=false
stack.enableByTarget(id, type); // Unsilence — flips enabled=true
stack.getEffective(id, type, key); // Net value considering only enabled modifiers
stack.getActiveKeys(id, type); // Set of currently active keys
stack.has(id, type, key); // Quick existence check
stack.getSources(id); // All source IDs affecting a target
```

### Silence / Equipment interaction

```
1. Equip Frog Fisher:     apply({ type:"trait", key:"barrier", sourceId:"Equip#17" })
                          → getEffective("barrier") = 1  ✓

2. Silence bearer:        disableByTarget("Unit#8", "trait")
                          → getEffective("barrier") = 0  ✓ (modifier still exists)

3. Unequip while silenced: removeBySource("Equip#17")
                          → modifier deleted
                          → getSources() = []  ✓

4. Unsilence:             enableByTarget("Unit#8", "trait")
                          → nothing to enable
                          → getEffective("barrier") = 0  ✓ (no negative!)
```

---

## Logger

### Design

The Logger captures **state diffs** before/after each root event and records **causation trees** from DFS event resolution.

### Log entry structure

```js
{
  id: 1,
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
          { eventName: "unit:destroyed", cancelled: false, children: [] },
          { eventName: "card:drawn", cancelled: false, children: [] }
        ]
      }
    ]
  },
  stateBefore: { /* snapshot */ },
  stateAfter:  { /* snapshot */ },
  diff: {
    added:   [{ key: "handSize", value: 6 }],
    removed: [{ key: "frontline.Unit#3" }],
    changed: [{ key: "frontline.Unit#1.hp", old: 5, new: 2 }]
  }
}
```

### Backends

The Logger supports **pluggable backends**:

- `MemoryBackend` (default): stores logs in memory, accessible via `getLogs()`.
- `ConsoleBackend`: prints to console in debug mode.
- Custom backends can be added via `addBackend(backend)`.

---

## Handler Registry

### Pattern

Each handler extends `BaseHandler` and implements:

- `validate(payload, context)` — throws on invalid input
- `execute(payload, context, gameState)` — performs the effect

Handlers use `context.emitChild()` for cascading effects and the `ModifierStack` for state changes — never mutate state directly.

### Baseline handlers

| Handler                   | What it does                                                  |
| ------------------------- | ------------------------------------------------------------- |
| `DealDamageHandler`       | Barrier → Resilient → Weak → apply damage → kill check → Slay |
| `HealHandler`             | Applies healing, capped at max HP                             |
| `GrantTraitHandler`       | Creates ModifierStack modifier for trait                      |
| `GiveConditionHandler`    | Creates ModifierStack modifier for condition; respects Immune |
| `CleanseHandler`          | Removes all condition modifiers from target                   |
| `CreateLighthouseHandler` | Delegates to `GameState.modifyLighthouses` (cap 40)           |
| `SpendShinsuHandler`      | Delegates to `ShinsuService.spend` (recharged first)          |
| `DrawCardHandler`         | Delegates to `ZoneService.draw`; emits `game:deck:empty`      |

---

## Standard Event Catalog

### Game & Round Lifecycle

- `game:started` — game constructed
- `game:over` — game ended (loss condition met)
- `round:started` / `round:ended` — round boundaries
- `turn:started` / `turn:ended` — player turn boundaries

### Unit Lifecycle

- `unit:deployed` — unit enters battlefield
- `unit:summoned` — unit summoned (incl. Shinheuh)
- `unit:destroy:intent` — cancellable pre-destroy hook
- `unit:death:intent` — cancellable lethal-damage hook before `unit:killed`
- `unit:undying:saved` — Undying prevented a lethal damage result
- `unit:destroyed` — unit leaves battlefield (ModifierStack auto-cleans)
- `unit:evolved` — unit transformed (evolution)
- `unit:killed` — unit HP reached 0
- `unit:position:switched` — unit moved to another position
- `unit:ability:used` — ability resolved
- `unit:ability:granted` — ability granted to a unit

#### Distinguishing overlapping unit events

Some unit events sound similar but carry distinct semantics and payloads. Subscribers must bind to the correct one.

**`unit:deployed` vs `unit:summoned`**

- `unit:deployed` — battlefield-entry announcement, emitted first. Payload: `{ username, unit, positionCode, cost }`. No trigger subscribes to it; it exists so observers (logging, future on-arrival effects) can react to the raw arrival.
- `unit:summoned` — the canonical event for `deploy` triggers, emitted immediately after `unit:deployed`, once native traits, evolution-trigger registration, passives, and attribute engines are fully wired. Payload: `{ username, unit, unitId }`. A unit's own "when I am deployed" evolution subscribes here and sees its complete observable state.

Ordering guarantee: `unit:deployed` always precedes `unit:summoned`.

**`unit:killed` vs `unit:destroyed`**

- `unit:killed` — emitted by `DealDamageHandler` when a unit's HP reaches 0, after `unit:death:intent` and Undying interception. The unit is still on the field at this point. Payload: `{ sourceId, targetId, killerId, killerOwner }`. Canonical for `slay` and `kill` triggers.
- `unit:destroyed` — emitted by `LifecycleEngine.destroyUnit` after the unit has been detached from equipment, removed from the field, moved to the discard pile, and had its subsystems cleaned up. `ModifierStack` auto-cleans its modifiers here. Payload: `{ unitId, unit, owner }`. Canonical for `ally_dies` triggers. It fires for **any** unit removal (lethal damage, line overflow, landmark replacement), not just combat deaths.

**Cancellable intent hooks**

- `unit:destroy:intent` — cancellable pre-removal hook emitted by `destroyUnit` before any mutation; cancelling prevents destruction.
- `unit:death:intent` — cancellable lethal-damage hook emitted before `unit:killed`; Undying cancels here to keep the unit alive at 1 HP.

### Damage & Healing

- `unit:damage:intent` — before damage resolution
- `unit:damage:applied` — after damage applied
- `unit:barrier:absorbed` — Barrier negated damage
- `unit:heal:applied` — healing applied

### Equipment

- `equipment:attached` — equipment attached to unit
- `equipment:detached` — equipment removed from unit
- `equipment:ignited` — attached equipment ignited

### Modifier Events (emitted by ModifierStack)

- `modifier:<type>:granted` / `modifier:<type>:revoked`
- `modifier:disabled` / `modifier:enabled`

### State Changes

- `state:shinsu:changed` — shinsu pool changed
- `shinsu:charged` / `shinsu:compressed` — resource gains/reductions
- `state:lighthouse:changed` — lighthouse count changed
- `game:lighthouses:depleted` — player's lighthouses reached 0 (triggers loss)
- `state:trait:granted` — trait granted via a `grant_trait` effect
- `state:condition:applied` / `state:condition:blocked` / `state:condition:cleansed`

### Cards

- `card:drawn` — card drawn from deck
- `card:reclaimed` — card reclaimed from discard
- `game:deck:empty` — player's deck exhausted (triggers loss)
- `effect:unsupported` — `custom` effect skipped with a warning

### Skills & Decisions

- `skill:applied` — skill played on a target
- `pending-decision` — a player choice is requested
- `decision:resolved` — a player choice was resolved

### Attributes

- `shinheuh:slot:granted` — Anima Shinheuh combat slot granted
- `hwayeomsa:charge:gained` — Fire Charge gained
- `hwayeomsa:incinerate:created` — Incinerate created

---

## Extension Guide

### Adding a new event

1. Choose a namespaced name: `category:subcategory:action`
2. Register handlers with appropriate phase and priority
3. Use `context.emitChild()` for cascading effects

### Adding a new handler

1. Create a class extending `BaseHandler`
2. Implement `validate(payload, context)` — throw on invalid
3. Implement `execute(payload, context, gameState)` — use ModifierStack
4. Register with `HandlerRegistry`

### Adding a new modifier type

1. Use an appropriate `type` value: `"trait"`, `"condition"`, `"stat"`, `"ability"`, `"keyword"`
2. `ModifierStack.apply()` will automatically emit `modifier:<type>:granted`
3. For removal, call `removeBySource()` or `removeWhere()` with a predicate

---

## Anti-patterns

1. **Don't mutate state directly** — always go through ModifierStack.
2. **Don't assume BFS ordering** — handlers after yours may not have run yet.
3. **Don't use `publish`/`subscribe`** — these were removed. Use `on`/`emit`.
4. **Don't cancel events lightly** — cancellation in `pre` prevents ALL later phases.
5. **Don't create infinite event loops** — use `maxDepth` protection as a safety net.
6. **Don't store mutable references from context** — `ctx.phase` changes during emission.

---

## Determinism Guarantees

Two runs with the same initial state, same clock ticks, same handler registrations, and same action sequence will produce:

1. Identical handler execution order
2. Identical event causation trees
3. Identical final state
4. Identical log entries

This is verified by the determinism tests in `EventBus.test.js` and `EventBus.integration.test.js` which run the same setup 20+ times and assert identical output.
