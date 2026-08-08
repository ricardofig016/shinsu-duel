# ModifierStack Architecture — Shinsu Duel

This document describes the provenance-tracked modifier system that underpins
all state changes in Shinsu Duel.

---

## Overview

The `ModifierStack` is the **sole authority for mutable state** on units.
Traits, conditions, stat buffs, granted abilities, and keyword overrides are
all represented as `Modifier` objects with a tracked **source**. This
provenance tracking is what makes reversible effects (unequip, cleanse,
silence) correct without manual bookkeeping.

| Concept                                       | Implementation                                   |
| --------------------------------------------- | ------------------------------------------------ |
| Every state change is a `Modifier`            | `stack.apply(spec)`                              |
| Equipment unequip removes only its modifiers  | `stack.removeBySource("Equip#17")`               |
| Silence disables traits without deleting them | `stack.disableByTarget(id, "trait")`             |
| Cleanse removes conditions only               | `stack.removeWhere(m => m.type === "condition")` |
| Unit death cleans up all modifiers on it      | Auto-hook on `unit:destroyed`                    |

---

## Modifier Structure

```js
{
  id:         "mod_42",         // unique, auto-generated
  sourceId:   "Equip#17",       // who created this modifier
  sourceType: "equipment",      // equipment | unit | skill | passive | landmark | system
  targetId:   "Unit#8",         // who receives the effect
  type:       "trait",          // trait | condition | stat | ability | keyword
  key:        "barrier",        // what is being modified
  value:      1,                // numeric value (or string for ability grants)
  operation:  "add",            // add | set | override
  enabled:    true,             // Silence flips to false
  createdAt:  42,               // GameClock tick
}
```

### Type values

| `type`      | Used for                                                      | Examples                                |
| ----------- | ------------------------------------------------------------- | --------------------------------------- |
| `trait`     | Native card traits + equipment-granted traits                 | Barrier, Strong, Lethal                 |
| `condition` | Negative temporary effects                                    | Burned, Poisoned, Rooted                |
| `stat`      | HP/damage/cost modifications                                  | +2 HP from equipment, -1 cost           |
| `ability`   | Granted abilities, `value` holds the JSON-encoded ability DSL | Red Thryssa grants "deal 5 to an enemy" |
| `keyword`   | Keyword overrides                                             | Quick, Free, Sharpshooter               |

Granted abilities are addressed by the bearer's player as
`granted:<modifierId>` through `UseAbilityAction`. Removing the modifier
(e.g. unequip) makes the code invalid — there is no separate revocation step.

### Operation values

| Operation  | Behavior                                                         | Use case               |
| ---------- | ---------------------------------------------------------------- | ---------------------- |
| `add`      | Sums with other modifiers of same key                            | Most traits/conditions |
| `set`      | Overrides all other values (returns immediately in getEffective) | Absolute stat setting  |
| `override` | Like set but also blocks future adds                             | Hard overrides         |

---

## Source ID Conventions

Source IDs **must be unique strings**. The codebase uses these
conventions:

| Source               | Pattern                      | Example                         |
| -------------------- | ---------------------------- | ------------------------------- |
| Unit's native traits | `"Unit#<card.id>"`           | `"Unit#a3f9c2b"`                |
| Equipment on bearer  | `"Equip#<card.id>"`          | `"Equip#d7e1a4f"`               |
| Passive ability      | `"Passive#<unitId>#<index>"` | `"Passive#a3f9c2b#0"`           |
| Activated ability    | `"Ability#<unitId>#<index>"` | `"Ability#a3f9c2b#1"`           |
| Skill (one-shot)     | `"Skill#<card.id>"`          | `"Skill#b2c8d9e"`               |
| System (game rules)  | `"system"`                   | shinsu reset, round-end cleanup |
| Landmark             | `"Landmark#<unitId>"`        | `"Landmark#f4a1b7c"`            |

**⚠️ The caller of `stack.apply()` is responsible for generating unique source IDs.**
The ModifierStack does not validate uniqueness across sources — it will happily
store duplicate source IDs and `removeBySource` will remove all of them.

---

## API Reference

### Apply

```js
const mod = stack.apply({
  sourceId: "Equip#17",
  sourceType: "equipment",
  targetId: "Unit#8",
  type: "trait",
  key: "barrier",
  value: 1,
  operation: "add", // default
});
// Emits: "modifier:trait:granted"
```

### Removal

```js
stack.removeBySource("Equip#17"); // unequip — removes all modifiers from that source
stack.removeByTarget("Unit#8"); // unit destroyed — removes all on that target
stack.removeWhere((m) => m.type === "condition"); // cleanse — removes conditions only
```

**⚠️ `removeBySource` and `removeByTarget` copy the array before iterating**
because `_removeOne` mutates the source array. If you add a new bulk-removal
method, follow the same pattern: `[...arr]` or collect IDs first.

### Silence / Unsilence

```js
stack.disableByTarget("Unit#8", "trait"); // silence — flips enabled=false
stack.disableByTarget("Unit#8", ["trait", "stat"]); // silence multiple types

stack.enableByTarget("Unit#8", "trait"); // unsilence — flips enabled=true
```

**⚠️ `disableByTarget` does NOT delete modifiers.** They remain in the stack
with `enabled: false`. This is the key design choice that prevents the
"negative trait after unequip + unsilence" bug.

### Query

```js
stack.getEffective("Unit#8", "trait", "strong"); // → 3 (sum of all add modifiers)
stack.getActiveKeys("Unit#8", "trait"); // → Set{"barrier", "strong"}
stack.has("Unit#8", "trait", "immune"); // → true/false
stack.getModifiers("Unit#8", "condition"); // → [{...}, {...}]
stack.getSources("Unit#8"); // → ["Equip#17", "Unit#a3f9c2b"]
```

**⚠️ `getEffective` respects `enabled`** — disabled modifiers contribute 0.
**⚠️ `getEffective` short-circuits on `operation: "set"` or `"override"`**
— returns the set value immediately, ignoring other modifiers of the same key.

---

## Auto-Cleanup Hook

The ModifierStack registers `bus.on("unit:destroyed", ...)` in its constructor.
When a unit is destroyed, `removeByTarget(unitId)` fires, cleaning up all
modifiers on that unit and all modifiers sourced from it.

**⚠️ This means `unit:destroyed` MUST be emitted for every unit removal.**
If you bypass the event and just splice the unit from the field array, the
ModifierStack will leak modifiers.

---

## The Silence / Equipment Problem (Solved)

This is the canonical interaction that drove the design:

```
1. EQUIP:    stack.apply({ key:"barrier", sourceId:"Equip#17", enabled:true })
             → getEffective("barrier") = 1 ✓

2. SILENCE:  stack.disableByTarget("Unit#8", "trait")
             → modifier still exists, enabled=false
             → getEffective("barrier") = 0 ✓

3. UNEQUIP:  stack.removeBySource("Equip#17")
             → modifier fully deleted
             → getSources() = [] ✓

4. UNSILENCE: stack.enableByTarget("Unit#8", "trait")
             → nothing to re-enable
             → getEffective("barrier") = 0 ✓  (NOT -1!)
```

Without source tracking, step 3 would need to know whether the trait was
"silenced away" or "equipment removed" — and step 4 would risk creating
a ghost negative value.

---

## Events Emitted

| Event                     | When                       |
| ------------------------- | -------------------------- |
| `modifier:<type>:granted` | `apply()` called           |
| `modifier:<type>:revoked` | `_removeOne()` called      |
| `modifier:disabled`       | `disableByTarget()` called |
| `modifier:enabled`        | `enableByTarget()` called  |

These are informational — the ModifierStack does its own state management.
External systems (Logger, UI) subscribe to them for auditing.

---

## Priority & Precedence

Multiple `set`/`override` modifiers on the same key now resolve by priority:
higher `priority` wins; tied priorities use most-recent-first (`createdAt`).

### Expiration

Modifiers can have `expiresAt: number` (GameClock tick). Call
`stack.removeExpired(now)` to clean up timed modifiers.

### Snapshot

`stack.snapshot()` returns a deep copy of all modifiers indexed by targetId,
for Logger diffs and serialization.

### ID Generation

`IdFactory.js` provides canonical source IDs: `Unit#<cardId>`, `Equip#<cardId>`,
`Ability#<unitId>#<idx>`, `Passive#<unitId>#<idx>`, `Skill#<cardId>`,
`Landmark#<unitId>`, `System`. All callers use `IdFactory` — no ad-hoc IDs.

### Auto-Cleanup Integration

- `unit:destroyed` — `removeByTarget`
- `game:round:end` — `removeWhere(m => m.type === "condition")`, wired in the GameState constructor
- Barrier tracking resets on `game:round:start`

### Snapshot Extension

`GameState._createSnapshot()` now includes active conditions, traits, equipment,
combat slots, shinheuh slots, and fire charges per unit — so Logger diffs
reflect all modifier-based state changes.

---

## Anti-patterns

- **Don't mutate unit properties directly** — always go through ModifierStack.
- **Don't forget to emit `unit:destroyed`** — or modifiers leak.
- **Don't iterate and remove without copying** — use `[...arr]`.
- **Don't rely on modifier ordering** — use `getEffective` for net values.
