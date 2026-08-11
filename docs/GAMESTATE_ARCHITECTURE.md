# GameState Architecture — Shinsu Duel

This document describes the GameState architecture: zone model, service layer, lifecycle engine, and snapshot/projection design.

---

## Overview

`GameState.js` is the authoritative runtime engine. It orchestrates all
services and owns the complete game state tree. No handler, action, or
engine mutates state directly — all mutations go through services.

| Service                | Responsibility                                            |
| ---------------------- | --------------------------------------------------------- |
| **ShinsuService**      | Shinsu pool math: reset, spend, gain, total               |
| **ZoneService**        | Card movement: draw, discard, add/remove from hand        |
| **CompressionService** | Card cost compression (per card instance)                 |
| **CombatSlotService**  | Position and Shinheuh combat slots                        |
| **LighthouseService**  | Lighthouse life total (cap 40, game-over at 0)            |
| **LifecycleEngine**    | Unit lifecycle: deploy, destroy, transform, equip         |
| **TriggerManager**     | Evolution/ignition: AST→event subscriptions               |
| **PassiveManager**     | Timed passives (round start/end): DSL→event subscriptions |
| **AttributeRegistry**  | Pluggable attribute engines (Anima, Hwayeomsa)            |

Each service owns one resource; nothing outside the service mutates it.
See `SERVICE_LAYER_ARCHITECTURE.md` for the full contract.

---

## Zone Model

Each player state has typed zones:

```js
{
  deck:        Card[],     // ordered, top = last element
  hand:        Card[],     // visible to owner only
  discard:     Card[],     // face-up
  field: {
    frontline: Unit[],
    backline:  Unit[],
  },
  lighthouses:  { amount, max: 40 },
  shinsu:       { normalAvailable, normalSpent, recharged },
  combatSlots:  { fisherman: { available }, light-bearer: { available }, ... },
  shinheuhSlot: { available, used },
  fireCharges:    number,  // Hwayeomsa resource
}
```

---

## Rules Enforced

| Rule                             | Enforcement                                       |
| -------------------------------- | ------------------------------------------------- |
| Max 5 units per line             | `LifecycleEngine.deployUnit` requests a choice    |
| Same-name unit check             | `LifecycleEngine.deployUnit` rejects duplicate    |
| Landmark replacement             | `LifecycleEngine.deployUnit` destroys old         |
| Frontline blocks backline        | `TargetResolver.resolveTargets`                   |
| Taunt forces targeting           | `TargetResolver.applyTauntFilter`                 |
| Conditions end-of-round          | `GameState` round end handler                     |
| Disabled suppresses passives     | `PassiveManager` condition check                  |
| Undying intercepts lethal damage | `unit:death:intent` before `unit:killed`          |
| Card requirements                | `RequirementValidator` before cost deduction      |
| First card this round            | `GameState._cardsPlayedThisRound` tracking        |
| Barrier resets per round         | `GameState` round start handler                   |
| Shinsu max = round num           | `ShinsuService.reset`                             |
| Recharged shinsu max 2           | `ShinsuService.reset`                             |
| Equipment returns on death       | `LifecycleEngine.destroyUnit`                     |
| Empty deck → loss                | `ZoneService.draw` → `GameState` game-over        |
| 0 lighthouses → loss             | Lighthouse-depleted event → `GameState` game-over |
| Unreachable cards                | Deck construction rejects them; draws do not skip |

---

## Pending Decisions

Some effects and actions require a player choice mid-resolution (target
selection, line-overflow destruction). `GameState.createPendingDecision()`
publishes the choice and blocks further `processAction()` calls until
`resolveDecision()` is called with a validated selection.

### Resolution Lifecycle State

The engine tracks an explicit `ResolutionState`:

| State       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `IDLE`      | No pending decisions; accepting actions and normal event flow |
| `RESOLVING` | One or more pending decisions exist; actions are blocked      |

`hasUnresolvedDecisions()` exposes the current state. The state
transitions `IDLE → RESOLVING` on `createPendingDecision()` and
`RESOLVING → IDLE` when the last decision is resolved and no stacked
decisions remain.

A line-overflow deployment is deferred: the card remains in hand and no
shinsu is spent while its owner chooses. Resolving a field-unit choice
destroys it before the card enters play; resolving the pending-card choice
pays for and discards that card without ever exceeding the five-unit limit.

### Nested Decisions & Stacking

Decisions are **stacked** LIFO. When a resolve callback creates a new
pending decision (e.g. an overflow destroy triggers a target-selection
effect), the new decision becomes the active one — the resolving decision
is **not** pushed to the stack since it's being cleaned up by the
resolution's `finally` block. Decisions created outside of a resolve
callback (while one is already pending) are pushed to the stack normally.

Nesting is capped at `MAX_RESOLUTION_DEPTH` (16) to prevent infinite
decision loops from buggy resolution callbacks.

### Re-entrancy Guard

`resolveDecision()` is NOT re-entrant: calling it from within a resolve
callback or `onResolved` continuation throws. Nested decisions must
use `createPendingDecision()` instead. The `finally` block always cleans
up the decision stack and transitions to `IDLE` when empty, even if the
resolve callback throws.

Callers that still have work to do after the choice resolves — e.g. ending
the turn, or resolving the next effect in a card's effect list — register a
continuation instead of running that work inline:

```js
gameState.completeActionAfterDecision(() => {
  // Runs immediately if there's no pending decision, or once the
  // current one resolves. Multiple continuations queue in order.
  gameState.endTurn();
});
```

This guarantees an action never advances the turn (or a card never resolves
its next effect) before the player's choice has actually changed state.

---

## LifecycleEngine API

```js
// Deploy a unit from hand
LifecycleEngine.deployUnit(gameState, username, handIndex, positionCode)
  → { unit, overflowDestroyed }

// Destroy a unit (emits unit:destroyed, cleans modifiers)
LifecycleEngine.destroyUnit(gameState, unit)

// Atomic transformation (evolution/ignition)
LifecycleEngine.transformUnit(gameState, unit, targetCardId)
LifecycleEngine.transformEquipment(gameState, unit, targetCardId, equipmentId)

// Attach equipment to unit. Normal units hold one equipment (replaced on re-equip);
// Living Ignition Weapons accumulate distinct equipment card definitions.
LifecycleEngine.attachEquipment(gameState, username, handIndex, targetUnit)

// Detach one equipment card (or all, if omitted). Ignited equipment
// reverts to its base form when it returns to hand.
LifecycleEngine.detachEquipment(gameState, unit, equipment?)
```

`unit.equipmentAttachments` is the canonical equipment representation.
It contains every attached card instance.

---

## Unit Lookup

`GameState._findUnit(unitId)` resolves a unit by instance ID through an
O(1) `_unitIndex` map, kept in sync by `LifecycleEngine` (`_indexUnit` on
deploy, `_unindexUnit` on destroy). A linear scan over both fields serves
as a fallback for unit-shaped test stubs that bypass the lifecycle engine.

---

## Event Catalog

All events use `namespace:subject:verb` format via `EventCatalog.js`:

| Legacy (PascalCase) | Canonical (EVT) |
| ------------------- | --------------- |
| `OnGameStart`       | `game:started`  |
| `OnRoundStart`      | `round:started` |
| `OnTurnEnd`         | `turn:ended`    |
| `OnDeployUnit`      | `unit:deployed` |
| `OnSummonUnit`      | `unit:summoned` |

---

## Snapshot Design

`GameState._createSnapshot()` captures the complete game state for the
Logger. It includes:

- Active conditions per unit (from ModifierStack)
- Active traits per unit (from ModifierStack)
- Runtime-granted ability codes per unit (from AbilityRegistry)
- Equipment attachments
- Combat slot status
- Shinheuh slot status
- Fire charges
- Discard pile size

The snapshot is called before/after each root event, enabling state diffs
that reflect trait/condition/charge changes.
