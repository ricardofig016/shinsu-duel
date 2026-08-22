# Passive System Architecture — Shinsu Duel

This document describes how timed passive abilities (round start / round end) are compiled and executed. For always-on passives that grant traits or abilities instead of firing on a timer, see `MODIFIER_STACK_ARCHITECTURE.md` and `HANDLER_SYSTEM_ARCHITECTURE.md`.

---

## Overview

Most unit passives are conditional checks read by other systems (e.g. "I ignore Taunt") and don't need a runtime subscription. A smaller set are **timed**: they fire automatically at round start or round end for as long as their unit is on the field. Those are compiled into structured DSL and executed by `PassiveManager`.

| Layer        | Location                                 | Purpose                                        |
| ------------ | ---------------------------------------- | ---------------------------------------------- |
| **Compiler** | `scripts/card-compile.js`                | Validates/normalizes structured passive nodes  |
| **Runtime**  | `server/game/services/PassiveManager.js` | Subscribes the compiled effect to round events |

---

## Compiled Shape

A timed passive is a structured DSL node with a structured `trigger` object:

```json
{
  "type": "deal_damage",
  "amount": 3,
  "target": { "side": "enemy", "scope": "all", "condition": "rooted" },
  "trigger": { "type": "round_end" },
  "raw": "round end: deal 3 to all Rooted enemies"
}
```

The `trigger.type` selects the subscription. `PassiveManager` currently wires `round_start` and `round_end`. Passives with no `trigger` at all are always-on and handled separately (see below).

---

## Runtime Behavior

`PassiveManager.registerUnit(unit, gameState)` is called by `LifecycleEngine` whenever a unit enters play (deploy or transformation). It scans `unit.card.passiveAbilities`, and for each entry with a `trigger.type` of `round_start` or `round_end`, subscribes to the matching round event and resolves the effect through the normal `EffectResolver` when it fires:

```js
passiveManager.registerUnit(unit, gameState);
passiveManager.unregisterUnit(unit.id);
```

The source ID is `Passive#<unitId>#<index>` (`IdFactory.passiveSource`), so any modifiers the passive applies (e.g. via `give_condition`) are provenance tracked like any other effect.

### Lifecycle

- **Deploy / evolve:** `registerUnit` is called after the new card definition is attached, so subscriptions always match the unit's current passives.
- **Evolve / transform:** subscriptions are unregistered and re-registered against the new card so a unit never keeps a previous form's passive.
- **Destroy:** `unregisterUnit` removes all subscriptions for that unit.
- Passives only fire while their unit is alive and still on the field — checked on every trigger, not just at registration time.

### Disabled

A unit with the `Disabled` condition does not trigger any registered passive. The condition is checked when the round event reaches the passive handler, so applying or removing it during the game takes effect without rebuilding the subscription. Disabled affects passive abilities; it does not remove traits or other modifiers.

### Ordering

Passive handlers run at `phase: "execute"` with a low priority, so they resolve **before** the round-end condition cleanup that removes conditions like Rooted or Burned. A passive that reads a condition (e.g. Karaka's "deal 3 to all Rooted enemies") sees it before it's cleared for the round.

### Always-on passives

A passive with **no `trigger`** is always-on: its effect tracks the live board rather than firing on a timer. `PassiveManager` subscribes these to round start; unit summoned/destroyed/evolved/position-switched; equipment attached/detached/ignited; and trait/condition grant/revoke events. On each such event it revokes the passive's prior grants (by `Passive#<unitId>#<index>` source) and re-resolves the passive, so a predicate that is no longer true stops applying and one that just became true starts applying. Re-apply is idempotent because every grant is tracked under the passive's source ID. A per-source re-entrancy guard stops a re-evaluation's own grant/revoke events from re-triggering it.

Always-on branches must be revoke-safe (modifier-backed: `grant_trait`, `give_condition`, modifiers, and their `sequence`/`conditional` compositions). The card schemas enforce this — a trigger-less passive whose branch has side effects fails validation.

---

## Example: Khun Ran - Evolved

```yaml
passives:
  - type: sequence
    trigger: { type: round_end }
    steps:
      - type: create_card
        card: { name: Redan }
      - type: transform
        cardName: Khun Ran
    raw: "round end: create Redan in your hand and revert me to Khun Ran"
```

`PassiveManager` wires the `round_end` trigger, which resolves the `sequence` through the `create_card` and `transform` handlers: the card `Redan` is created in hand, then the unit's definition is swapped back to `Khun Ran` via `LifecycleEngine.transformUnit`.
