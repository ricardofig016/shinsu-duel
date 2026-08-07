# GameState Architecture — Shinsu Duel

This document describes the GameState architecture: zone model, service layer, lifecycle engine, and snapshot/projection design.

---

## Overview

`GameState.js` is the authoritative runtime engine. It orchestrates all
services and owns the complete game state tree. No handler, action, or
engine mutates state directly — all mutations go through services.

| Service               | Responsibility                                     |
| --------------------- | -------------------------------------------------- |
| **ShinsuService**     | Shinsu pool math: reset, spend, gain, total        |
| **ZoneService**       | Card movement: draw, discard, add/remove from hand |
| **LifecycleEngine**   | Unit lifecycle: deploy, destroy, transform, equip  |
| **TriggerManager**    | Evolution/ignition: AST→event subscriptions        |
| **AttributeRegistry** | Pluggable attribute engines (Anima, Hwayeomsa)     |

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
  lighthouses: { amount, max: 40 },
  shinsu:      { normalAvailable, normalSpent, recharged },
  combatSlots: { fisherman: { available }, light-bearer: { available }, ... },
  shinheuhSlot:{ available, used },
  fireCharges:    number,  // Hwayeomsa resource
}
```

---

## Rules Enforced

| Rule                       | Enforcement                                       |
| -------------------------- | ------------------------------------------------- |
| Max 5 units per line       | `LifecycleEngine.deployUnit` requests a choice    |
| Same-name unit check       | `LifecycleEngine.deployUnit` rejects duplicate    |
| Landmark replacement       | `LifecycleEngine.deployUnit` destroys old         |
| Frontline blocks backline  | `TargetResolver.resolveTargets`                   |
| Taunt forces targeting     | `TargetResolver.applyTauntFilter`                 |
| Conditions end-of-round    | `GameState` round end handler                     |
| Barrier resets per round   | `GameState` round start handler                   |
| Shinsu max = round num     | `ShinsuService.reset`                             |
| Recharged shinsu max 2     | `ShinsuService.reset`                             |
| Equipment returns on death | `LifecycleEngine.destroyUnit`                     |
| Empty deck → loss          | `ZoneService.draw` → `GameState` game-over        |
| 0 lighthouses → loss       | Lighthouse-depleted event → `GameState` game-over |
| Unreachable cards          | Deck construction rejects them; draws do not skip |

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

// Attach equipment to unit
LifecycleEngine.attachEquipment(gameState, username, handIndex, targetUnit)

// Detach equipment (returns to hand, de-ignited)
LifecycleEngine.detachEquipment(gameState, unit)
```

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
- Equipment attachments
- Combat slot status
- Shinheuh slot status
- Compress amount
- Fire charges
- Discard pile size

The snapshot is called before/after each root event, enabling state diffs
that reflect trait/condition/charge changes.
