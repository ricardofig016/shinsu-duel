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

## Related Systems

- The **ModifierStack** (provenance-tracked state modifier storage) — see `MODIFIER_STACK_ARCHITECTURE.md`.
- The **Logger** (full-state-diff event logger) — see `LOGGER_ARCHITECTURE.md`.
- The **handler registry** that maps DSL node types to handler classes — see `HANDLER_SYSTEM_ARCHITECTURE.md`.

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
- `unit:ability:used` — ability resolved; payload `{ username, unitId, abilityCode, quick }` (the `quick` flag gates `quick_ability_used` passives/equipment triggers and `quick` keyword consumption)
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

Equipment effects with a non-`equip` trigger (e.g. `deal_damage`, `quick_ability_used`) subscribe to their canonical event through `GameState.registerEquipmentTriggeredEffect` for the equipment's lifetime and are removed on detach.

### Lifecycle & Zone Movement

- `card:discarded` — a card was sent to the discard pile (hand discard or bearer attachment discard)
- `unit:stolen` — a deployed unit was moved to the acting player's field
- `unit:silenced` — a unit's traits were removed (`remove_traits` / Silence)
- `hand:peeked` — a player's hand was revealed (observer-only; no mutation)

### Modifier Events

Emitted by the `ModifierStack` — see `MODIFIER_STACK_ARCHITECTURE.md`.

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
- `card:created` — a card was created directly into a player's hand (e.g. `create_card`)
- `game:deck:empty` — player's deck exhausted (triggers loss)
- `effect:unsupported` — an effect `type` with no registered handler is skipped

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

Create a class extending `BaseHandler` implementing `validate`/`execute`, then register it with the `HandlerRegistry` — see `HANDLER_SYSTEM_ARCHITECTURE.md`.

### Adding a new modifier type

Use an appropriate `type` value (`trait`, `condition`, `stat`, `ability`, `keyword`) and the `apply`/`removeBySource`/`removeWhere` APIs — see `MODIFIER_STACK_ARCHITECTURE.md`.

---

## Anti-patterns

1. **Don't assume BFS ordering** — handlers after yours may not have run yet.
2. **Don't use `publish`/`subscribe`** — these were removed. Use `on`/`emit`.
3. **Don't cancel events lightly** — cancellation in `pre` prevents ALL later phases.
4. **Don't create infinite event loops** — use `maxDepth` protection as a safety net.
5. **Don't store mutable references from context** — `ctx.phase` changes during emission.

---

## Determinism Guarantees

Two runs with the same initial state, same clock ticks, same handler registrations, and same action sequence will produce:

1. Identical handler execution order
2. Identical event causation trees
3. Identical final state
4. Identical log entries

This is verified by the determinism tests in `tests/core/EventBus.test.js` and `tests/integration/EventBus.integration.test.js` which run the same setup 20+ times and assert identical output.
