# Passive System Architecture — Shinsu Duel

This document describes how triggered and timed passive abilities are compiled and executed. For always-on passives that grant traits or abilities instead of firing on an event, see `MODIFIER_STACK_ARCHITECTURE.md` and `HANDLER_SYSTEM_ARCHITECTURE.md`.

---

## Overview

Most unit passives are conditional checks read by other systems (e.g. "I ignore Taunt") and don't need a runtime subscription. A smaller set are **event-driven**: they fire on their authored trigger events, from round start and round end through deaths, draws, reclaims, equips, and Free ability uses, for as long as their unit is on the field. Those are compiled into structured DSL and executed by `PassiveManager`.

A landmark's `rules` are not passives. `GlobalRuleRegistry` registers, queries, and revokes them. `PassiveManager` checks `disable_passives` when it registers, re-evaluates, and executes triggered or always-on passives. That query excludes Irregular units, so Floor of Death suppresses a standard unit's passives but never an Irregular's passives. A landmark's own triggered effects remain ordinary `passives` handled here.

| Layer        | Location                                 | Purpose                                        |
| ------------ | ---------------------------------------- | ---------------------------------------------- |
| **Compiler** | `scripts/card-compile.js`                | Validates/normalizes structured passive nodes  |
| **Runtime**  | `server/game/services/PassiveManager.js` | Subscribes the compiled effect to its trigger's event |

---

## Compiled Shape

A triggered passive is a structured DSL node with a structured `trigger` object:

```json
{
  "type": "deal_damage",
  "amount": 3,
  "target": { "side": "enemy", "scope": "all", "condition": "rooted" },
  "trigger": { "type": "round_end" },
  "raw": "round end: deal 3 to all Rooted enemies"
}
```

The `trigger.type` selects the subscription. `PassiveManager` wires `round_start`, `round_end`, `skill_played`, `deal_damage`, `quick_ability_used`, `summon`, `deploy`, `activation`, `draw`, `reclaim`, `equip`, `dies`, `ally_dies`, `free_ability_played`, and `evolve`. The `summon` trigger matches an authored `source` against the summoned unit's `kind` (or name); the `deploy` trigger fires on the unit's own deployment; the `activation` trigger fires on the `unit:activation` event and only for the unit that event names (`payload.unitId`), so activating a Conduit replays its passives while other bearers of the same card stay silent. `draw` and `reclaim` fire for the passive owner's own card movements, filtered by the authored `cardType` (`unit` | `skill` | `equipment`); `draw` observes every draw including the round-start draw. `equip` fires when the unit is equipped, narrowed by the authored `cardName` when present. `dies` and `ally_dies` fire on the `unit:killed` event: the lethal pipeline announces the death while the dying unit's own subscriptions are still live, so a self-`dies` passive resolves before cleanup, and non-death removals (substitution, landmark replacement, returning to hand) never fire them. `free_ability_played` fires on the `free` flag of the `unit:ability:used` event for any player's Free ability. `evolve` fires on the `unit:evolving` announcement that precedes an evolution, so the outgoing form's passive resolves before its subscription is swapped; a `transform`-effect revert is not an evolution and never fires it. Passives with no `trigger` at all are always-on and handled separately (see below).

An effect that fires on more than one event declares a `triggers` array of single-event trigger objects instead of a compound trigger type; each entry is parsed and subscribed independently to its own event:

```json
{
  "type": "conditional",
  "triggers": [{ "type": "round_start" }, { "type": "activation" }],
  "if": { "type": "has_unit", "target": { "side": "enemy", "attribute": "jeonsulsa" }, "negate": true },
  "then": { "type": "slay", "target": { "side": "self" } }
}
```

A passive carrying `triggers` is event-driven like any triggered passive — `reapplyAll` never treats it as always-on.

---

## Runtime Behavior

`PassiveManager.registerUnit(unit, gameState)` is called by `LifecycleEngine` whenever a unit enters play (deploy or transformation). It scans `unit.card.passiveAbilities`, and for each entry with a supported `trigger.type`, subscribes to the matching event and resolves the effect through the normal `EffectResolver` when it fires:

```js
passiveManager.registerUnit(unit, gameState);
passiveManager.unregisterUnit(unit.id);
```

The source ID is `Passive#<unitId>#<index>` (`IdFactory.passiveSource`), so any modifiers the passive applies (e.g. via `give_condition`) are provenance tracked like any other effect.

Trigger context is threaded into the resolution: a `deal_damage` passive resolves against the damaged unit (`payload.targetId`), a `quick_ability_used` passive resolves `owner`-relative steps such as `charge_shinsu` against the unit that used the ability (`payload.username`), a `free_ability_played` passive resolves them the same way (an `extinguish` with `owner: "self"` hits the ability user's lighthouses), and a `reclaim` passive resolves card-consuming steps against the reclaimed card itself (`targetCardId`), so Kurudan's "Compress 1 from it" never opens a hand selection. A `skill_played` passive only fires for the passive owner's own skill play.

### Lifecycle

- **Deploy / evolve:** `registerUnit` is called after the new card definition is attached, so subscriptions always match the unit's current passives.
- **Evolve / transform:** subscriptions are unregistered and re-registered against the new card so a unit never keeps a previous form's passive.
- **Destroy:** `unregisterUnit` removes all subscriptions for that unit.
- A landmark's deploy-time `choose_position` passive opens a `position_selection` decision bound to the landmark unit. Resolving it stores the picked code on the unit and activates its `position: "chosen"` rules; if the landmark leaves play while the choice is still pending, `LifecycleEngine` cancels the decision and the resolver becomes a no-op, so a destroyed landmark can never resurrect its rules.
- Passives only fire while their unit is still on the field, and — except for the death triggers, which resolve at `unit:killed` while the dying unit sits at 0 HP — while it is alive. Checked on every trigger, not just at registration time.

### Disabled

A unit with the `Disabled` condition does not trigger any registered passive. The condition is checked when the round event reaches the passive handler, so applying or removing it during the game takes effect without rebuilding the subscription. Disabled affects passive abilities; it does not remove traits or other modifiers. Always-on passives (conditionals and modifiers) honor it too: when Disabled is granted their grants are revoked by source, and when it is removed they are re-applied.

### Ordering

Passive handlers run at `phase: "execute"` with a low priority, so they resolve **before** the round-end condition cleanup that removes conditions like Rooted or Burned. A passive that reads a condition (e.g. Karaka's "deal 3 to all Rooted enemies") sees it before it's cleared for the round.

### Always-on passives

A passive with **neither `trigger` nor a non-empty `triggers`** is always-on: its effect tracks the live board rather than firing on a timer. `PassiveManager` subscribes these to round start; unit summoned/destroyed/evolved/position-switched; equipment attached/detached/ignited; and trait/condition grant/revoke events. On each such event it revokes the passive's prior grants (by `Passive#<unitId>#<index>` source) and re-resolves the passive, so a predicate that is no longer true stops applying and one that just became true starts applying. Re-apply is idempotent because every grant is tracked under the passive's source ID. A per-source re-entrancy guard stops a re-evaluation's own grant/revoke events from re-triggering it.

Always-on branches must be revoke-safe (modifier-backed: `grant_trait`, `give_condition`, modifiers, and their `sequence`/`conditional` compositions). The card schemas enforce this — a trigger-less passive whose branch has side effects fails validation.

Trigger-less **modifier** passives (`modify_stat`/`modify_cost`/`modify_condition`/`modify_keyword`/`modify_targeting`/`modify_repeat`/`retain_equipment`/`modify_ability`) follow the same always-on path: `PassiveManager` revokes by source then re-applies them through `ModifierService` on the same event set. Position-scoped passives (`position` on the node) apply only while the source unit occupies that position.

---

## Example: Khun Ran II

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
