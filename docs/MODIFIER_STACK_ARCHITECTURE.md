# ModifierStack Architecture — Shinsu Duel

This document describes the provenance-tracked modifier system that underpins all state changes in Shinsu Duel.

---

## Overview

The `ModifierStack` is the **sole authority for mutable state** on units. Traits, conditions, stat buffs, granted abilities, and keyword overrides are all represented as `Modifier` objects with a tracked **source**. This provenance tracking is what makes reversible effects (unequip, cleanse, silence) correct without manual bookkeeping.

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
  type:       "trait",          // trait | condition | stat | ability | keyword | rule
  key:        "barrier",        // what is being modified
  value:      1,                // numeric value
  operation:  "add",            // add | set | override
  disabledCount: 0,             // 0 = active; each silence/disable increments
  createdAt:  42,               // GameClock tick
}
```

### Type values

| `type`      | Used for                                                   | Examples                           |
| ----------- | ---------------------------------------------------------- | ---------------------------------- |
| `trait`     | Native card traits + equipment-granted traits              | Barrier, Strong, Lethal            |
| `condition` | Negative temporary effects                                 | Burned, Poisoned, Rooted           |
| `stat`      | HP/damage/cost modifications                               | +2 HP from equipment, -1 cost      |
| `ability`   | Granted-ability lifetime marker; `key` is the ability code | Tracks `grant_ability` for cleanup |
| `keyword`   | Keyword overrides                                          | Quick, Free, Sharpshooter          |
| `rule`      | Battlefield landmark rules, source-tracked                 | Floor of Death, Water Stadium      |

Granted abilities themselves live in the `AbilityRegistry` (structured DSL, not JSON) and are addressed by the bearer's player as `granted:<sourceId>:<type>` through `UseAbilityAction`. The ModifierStack entry with `type: "ability"` exists purely to tie the grant's lifetime to its source: removing the source (e.g. unequip) revokes both the modifier and the registry entry.

### Operation values

| Operation  | Behavior                                                                                                                              | Use case               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `add`      | Sums with other modifiers of same key                                                                                                 | Most traits/conditions |
| `set`      | Overrides `add` modifiers; highest-priority set wins                                                                                  | Absolute stat setting  |
| `override` | Overrides both `set` and `add` modifiers; the highest-priority enabled override wins and all other modifiers for that key are ignored | Hard overrides         |

---

## Source ID Conventions

Source IDs **must be unique strings**. The codebase uses these conventions:

| Source               | Pattern                      | Example                         |
| -------------------- | ---------------------------- | ------------------------------- |
| Unit's native traits | `"Unit#<card.id>"`           | `"Unit#a3f9c2b"`                |
| Equipment on bearer  | `"Equip#<card.id>"`          | `"Equip#d7e1a4f"`               |
| Passive ability      | `"Passive#<unitId>#<index>"` | `"Passive#a3f9c2b#0"`           |
| Activated ability    | `"Ability#<unitId>#<index>"` | `"Ability#a3f9c2b#1"`           |
| Skill (one-shot)     | `"Skill#<card.id>"`          | `"Skill#b2c8d9e"`               |
| System (game rules)  | `"system"`                   | shinsu reset, round-end cleanup |
| Landmark             | `"Landmark#<unitId>"`        | `"Landmark#f4a1b7c"`            |

**⚠️ The caller of `stack.apply()` is responsible for generating unique source IDs.** The ModifierStack does not validate uniqueness across sources — it will happily store duplicate source IDs and `removeBySource` will remove all of them.

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

**⚠️ `removeBySource` and `removeByTarget` copy the array before iterating** because `_removeOne` mutates the source array. If you add a new bulk-removal method, follow the same pattern: `[...arr]` or collect IDs first.

### Silence / Unsilence

```js
stack.disableByTarget("Unit#8", "trait"); // silence — increments disabledCount
stack.disableByTarget("Unit#8", ["trait", "stat"]); // silence multiple types

stack.enableByTarget("Unit#8", "trait"); // unsilence — decrements disabledCount
```

**⚠️ `disableByTarget` does NOT delete modifiers.** It increments `disabledCount`. Only when every silencing effect has been reversed (disabledCount === 0) does the modifier become active again.

**Overlapping silence:** Two silence effects on the same target increment `disabledCount` to 2. Removing one silence decrements to 1 — the modifier is still suppressed. Both must be removed for the modifier to reappear. This is the key design choice that prevents the "negative trait after unequip + unsilence" bug and makes overlapping suppression effects safe.

### Query

```js
stack.getEffective("Unit#8", "trait", "strong"); // → 3 (sum of all add modifiers)
stack.getActiveKeys("Unit#8", "trait"); // → Set{"barrier", "strong"}
stack.has("Unit#8", "trait", "immune"); // → true/false
stack.getModifiers("Unit#8", "condition"); // → [{...}, {...}]
stack.getSources("Unit#8"); // → ["Equip#17", "Unit#a3f9c2b"]
```

**⚠️ `getEffective` respects `disabledCount`** — suppressed modifiers contribute 0. **⚠️ `getEffective` precedence:** `override` > `set` > `add`. A single enabled `override` ignores all `set` and `add` modifiers for that key. A single enabled `set` ignores all `add` modifiers. When multiple `override` or `set` modifiers exist, highest priority wins (ties break by most recent `createdAt`).

---

## Cross-System Cleanup (onRevoke Bridge)

```js
stack.onRevoke((mod) => {
  if (mod.type === "ability") {
    abilityRegistry.revokeBySource(mod.targetId, mod.sourceId);
  }
});
```

The `onRevoke` callback is invoked for **every** removed modifier. It is the **sole bridge** from ModifierStack cleanup to external registries. `GameState` wires it to cascade ability-type modifier removal to `AbilityRegistry` cleanup. No other system calls `AbilityRegistry` cleanup methods directly — all paths go through this bridge.

This ensures a single ownership model: `ModifierStack` owns modifier lifetimes, `AbilityRegistry` owns ability DSL data, and the bridge keeps them synchronized without duplicated cleanup calls.

## Auto-Cleanup Hook

The ModifierStack registers `bus.on("unit:destroyed", ...)` in its constructor. When a unit is destroyed, `removeByTarget(unitId)` fires, cleaning up all modifiers on that unit and all modifiers sourced from it. The `onRevoke` bridge then cascades to any registered external cleanup (e.g. AbilityRegistry).

**⚠️ This means `unit:destroyed` MUST be emitted for every unit removal.** If you bypass the event and just splice the unit from the field array, the ModifierStack will leak modifiers.

---

## The Silence / Equipment Problem (Solved)

This is the canonical interaction that drove the design:

```
1. EQUIP:    stack.apply({ key:"barrier", sourceId:"Equip#17", enabled:true })
             → getEffective("barrier") = 1 ✓

2. SILENCE:  stack.disableByTarget("Unit#8", "trait")
             → modifier still exists, disabledCount=1
             → getEffective("barrier") = 0 ✓

3. UNEQUIP:  stack.removeBySource("Equip#17")
             → modifier fully deleted
             → getSources() = [] ✓

4. UNSILENCE: stack.enableByTarget("Unit#8", "trait")
             → nothing to re-enable (disabledCount was already 0 for
               the removed modifier)
             → getEffective("barrier") = 0 ✓  (NOT -1!)
```

Without source tracking, step 3 would need to know whether the trait was "silenced away" or "equipment removed" — and step 4 would risk creating a ghost negative value.

---

## Events Emitted

| Event                     | When                       |
| ------------------------- | -------------------------- |
| `modifier:<type>:granted` | `apply()` called           |
| `modifier:<type>:revoked` | `_removeOne()` called      |
| `modifier:disabled`       | `disableByTarget()` called |
| `modifier:enabled`        | `enableByTarget()` called  |

These are informational — the ModifierStack does its own state management. External systems (Logger, UI) subscribe to them for auditing.

---

## Consultation helpers (always-on modifiers)

Always-on modifier passives and equipment effects (`modify_stat`/`modify_keyword`/`modify_targeting`/`modify_condition`/`modify_repeat`/`retain_equipment`/`modify_ability`) are applied by `ModifierService` as `stat`, `keyword`, or `ability-augment` entries. The systems that consume them query the stack through filter-aware helpers that read the modifier's stored `meta` (the `when`/`source`/`victimFilter`/`blockedFilter`/`first`/`effect` metadata) against passed unit references:

| Helper                                | Consumed by            | Reads                                                       |
| ------------------------------------- | ---------------------- | ----------------------------------------------------------- |
| `getDamageDealt(src,dst)`             | `DealDamageHandler`    | `stat: damage` with `when` target filter                    |
| `getHealModifier(src,dst)`            | `HealHandler`          | `stat: heal` with `when` target filter                      |
| `getDamageTaken(dst,src)`             | `DealDamageHandler`    | `stat: damage_taken` with `source` attacker filter          |
| `getConditionAmplifier(src,dst,cond)` | `GiveConditionHandler` | `stat: condition` with victim filter                        |
| `getKeywords(unit, isFirst)`          | `UseAbilityAction`     | `keyword` (quick/free), `first`-scoped per round            |
| `getTargetingRules(unit)`             | `TargetResolver`       | `keyword` ignore_taunt / untargetable_by (+ blocked filter) |
| `getRepeat(unit)`                     | `UseAbilityAction`     | `stat: repeat`                                              |
| `hasRetainEquipment(unit)`            | `return_to_hand`       | `keyword` retain_equipment                                  |
| `getAbilityAugments(unit)`            | `EffectResolver`       | `ability-augment` effect nodes                              |
| `matchesUnitFilter(unit, filter)`     | `TargetResolver`       | shared `unitFilter` evaluation                              |

All helpers are pure queries — they never mutate state and take unit references rather than `GameState`, so the stack stays decoupled from the board. Card cost (`stat: cost` keyed to a player, plus a card's own `modify_cost`) is consulted through `ModifierService.getEffectiveCost`, which is the single cost authority for play/deploy/equip.

`getAbilityAugments` returns every augment attached to a unit; `EffectResolver` applies each matching augment **once per target per trigger**. `UseAbilityAction` resets the dedupe set before each `modify_repeat` trigger, so a repeated ability re-applies its augments once per trigger, while a multi-step ability within one trigger still applies each augment once.

A `when`/`source`-filtered modifier only amplifies when a matching unit reference is passed: `getDamageDealt`/`getHealModifier` require a source unit, and `getDamageTaken` ignores its `source` filter (returns 0) when the damage has no attacking unit (e.g. skill-cast damage).

## Priority & Precedence

Multiple `set`/`override` modifiers on the same key now resolve by priority: higher `priority` wins; tied priorities use most-recent-first (`createdAt`).

### Expiration

Modifiers can carry `expiresAt: number` (GameClock tick) for future timed effects; the field is stored but no cleanup pass is wired yet.

### Snapshot

Modifier state is surfaced through `GameState._createSnapshot()`, which includes active conditions, traits, equipment, combat slots, shinheuh slots, and fire charges per unit — so Logger diffs reflect all modifier-based state changes.

### ID Generation

`IdFactory.js` provides canonical source IDs: `Unit#<cardId>`, `Equip#<cardId>`, `Ability#<unitId>#<idx>`, `Passive#<unitId>#<idx>`, `Skill#<cardId>`, `Landmark#<unitId>`, `System`. All callers use `IdFactory` — no ad-hoc IDs. Instance IDs (`Card#<cardId>#<seq>`, `Unit#<cardId>#<seq>`) and pending-decision IDs (`decisionId()`) come from the same factory.

### Auto-Cleanup Integration

- `unit:destroyed` — `removeByTarget`
- `round:ended` — `removeWhere(m => m.type === "condition")`, wired in the GameState constructor
- Barrier tracking resets on `round:started`

---

## Anti-patterns

- **Don't mutate unit properties directly** — always go through ModifierStack.
- **Don't forget to emit `unit:destroyed`** — or modifiers leak.
- **Don't iterate and remove without copying** — use `[...arr]`.
- **Don't rely on modifier ordering** — use `getEffective` for net values.
