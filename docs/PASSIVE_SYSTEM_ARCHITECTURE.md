# Passive System Architecture — Shinsu Duel

This document describes how timed passive abilities (round start / round end)
are compiled and executed. For always-on passives that grant traits or
abilities instead of firing on a timer, see `MODIFIER_STACK_ARCHITECTURE.md`
and `HANDLER_SYSTEM_ARCHITECTURE.md`.

---

## Overview

Most unit passives are conditional checks read by other systems (e.g. "I
ignore Taunt") and don't need a runtime subscription. A smaller set are
**timed**: they fire automatically at round start or round end for as long
as their unit is on the field. Those are compiled into structured DSL and
executed by `PassiveManager`.

| Layer        | Location                                     | Purpose                                          |
| ------------ | -------------------------------------------- | ------------------------------------------------ |
| **Compiler** | `scripts/card-compile.js` `compilePassive()` | Detects the `round start:` / `round end:` prefix |
| **Runtime**  | `server/game/services/PassiveManager.js`     | Subscribes the compiled effect to round events   |

---

## Compiled Shape

A passive compiles to a timed DSL object only if its prefix is recognized
**and** the remaining text resolves to a structured effect (the same
parser used for abilities and skill effects):

```json
{
  "type": "deal_damage",
  "amount": 3,
  "target": "all_enemies",
  "condition": "rooted",
  "raw": "round end: deal 3 to all Rooted enemies",
  "trigger": "round end"
}
```

If the remaining text doesn't resolve to a structured effect, the whole
passive compiles as `type: "custom"` with no `trigger` field — `PassiveManager`
ignores it, same as any other unresolved effect.

---

## Runtime Behavior

`PassiveManager.registerUnit(unit, gameState)` is called by `LifecycleEngine`
whenever a unit enters play (deploy or transformation). It scans
`unit.card.passiveAbilities`, and for each entry with a `trigger` field,
subscribes to `round:started` or `round:ended` and resolves the effect
through the normal `EffectResolver` when it fires:

```js
passiveManager.registerUnit(unit, gameState);
passiveManager.unregisterUnit(unit.id);
```

The source ID is `Passive#<unitId>#<index>` (`IdFactory.passiveSource`), so
any modifiers the passive applies (e.g. via `give_condition`) are provenance
tracked like any other effect.

### Lifecycle

- **Deploy / evolve:** `registerUnit` is called after the new card
  definition is attached, so subscriptions always match the unit's current
  passives.
- **Evolve / transform:** subscriptions are unregistered and re-registered
  against the new card so a unit never keeps a previous form's passive.
- **Destroy:** `unregisterUnit` removes all subscriptions for that unit.
- Passives only fire while their unit is alive and still on the field —
  checked on every trigger, not just at registration time.

### Disabled

A unit with the `Disabled` condition does not trigger any registered passive.
The condition is checked when the round event reaches the passive handler, so
applying or removing it during the game takes effect without rebuilding the
subscription. Disabled affects passive abilities; it does not remove traits
or other modifiers.

### Ordering

Passive handlers run at `phase: "execute"` with a low priority, so they
resolve **before** the round-end condition cleanup that removes conditions
like Rooted or Burned. A passive that reads a condition (e.g. Karaka's
"deal 3 to all Rooted enemies") sees it before it's cleared for the round.

---

## Example: Khun Ran - Evolved

```yaml
passives:
  - "round end: create Redan in your hand and revert me to Khun Ran"
```

This compiles as `type: "custom"` — "create ... and revert me" isn't a single
structured effect, so it isn't wired to a runtime subscription yet. Extending
`parseEffectWithMetadata()` to recognize this pattern is the only change
needed to make it timed; `PassiveManager` requires no changes.
