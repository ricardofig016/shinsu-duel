# Service Layer Architecture — Shinsu Duel

This document describes the authoritative resource services that own all
state mutation in the game engine.

---

## Overview

The engine enforces a strict ownership rule: **if a service exists for a
resource, nothing else mutates it.** Handlers, actions, engines, and
attribute engines never touch resource fields directly — they delegate to
the owning service. This keeps every mutation in one place, so validation,
events, caps, and cleanup are always applied consistently and future
mechanics cannot corrupt state by writing around the rules.

`GameState` is the orchestrator. It exposes thin delegation methods for
services that need game-wide context (e.g. game-over detection) and keeps
direct references for the rest.

| Service               | Resource                       | Mutation API                                           |
| --------------------- | ------------------------------ | ------------------------------------------------------ |
| **ShinsuService**     | `playerState.shinsu`           | `reset`, `spend`, `gain`, `getTotal`, `canAfford`      |
| **ZoneService**       | `deck` / `hand` / `discard`    | `draw`, `discard`, `reclaimTop`, `removeFromHand`, `addToHand` |
| **CompressionService**| `card.costReduction`           | `compress`, `clearReduction`, `getReduction`           |
| **CombatSlotService** | `combatSlots` + `shinheuhSlot` | position slots + Shinheuh slot (see below)             |
| **LighthouseService** | `playerState.lighthouses`      | `modify` (cap 0–40, game-over at 0)                    |

---

## ShinsuService

Owns the shinsu pools (`normalAvailable`, `normalSpent`, `recharged`).
Spending deducts recharged first, then normal; gaining always adds to the
normal pool. Reset carries over up to 2 unspent shinsu as recharged.

## ZoneService

Sole path for card movement between zones. `draw` emits `game:deck:empty`
when the deck is exhausted; `removeFromHand` and `discard` clear a card's
compression so it returns to base cost outside the hand.

## CompressionService

Owns per-card-instance cost reduction (`card.costReduction`). Compression
stacks additively across sources. `clearReduction` is invoked by
`ZoneService` when a card leaves the hand, so compression never persists
into the discard pile or onto the battlefield.

```js
CompressionService.compress(card, 2, context); // → { compressed, totalReduction }
CompressionService.clearReduction(card);
```

## CombatSlotService

Owns **all** combat slots: the five position slots plus the Shinheuh slot.
Position slots reset each round and are consumed by non-Free ability use.
The Shinheuh slot (Anima attribute) is granted at round start, consumed by
Shinheuh ability use, and reset at round end — all through this service;
`AnimaEngine` only decides *when* to grant, never touches the slot directly.

```js
CombatSlotService.isAvailable(playerState, "fisherman");
CombatSlotService.consume(playerState, "fisherman");
CombatSlotService.resetAll(playerState);

// Shinheuh slot
CombatSlotService.isShinheuhSlotAvailable(playerState);
CombatSlotService.grantShinheuhSlot(playerState, eventBus, owner);
CombatSlotService.consumeShinheuhSlot(playerState);
CombatSlotService.resetShinheuhSlot(playerState);
```

## LighthouseService

Owns the lighthouse life total. `modify` clamps to 0–40, and reaching 0
sets `gameState.gameOver` and emits `game:lighthouses:depleted` +
`game:over`. `GameState.modifyLighthouses()` is a thin wrapper that forwards
to it.

---

## Integration

- **Handlers** delegate shared-resource changes (see
  `HANDLER_SYSTEM_ARCHITECTURE.md`).
- **Actions** validate via the same services before mutating (see
  `ACTION_SYSTEM_ARCHITECTURE.md`).
- **LifecycleEngine** composes them for deploy/destroy/equip.
- **Attribute engines** mutate only through `GameState` delegation
  (`CombatSlotService` for the Shinheuh slot, `_modifyFireCharges` for fire
  charges), never by writing resource fields directly.

## Adding a New Service

1. Create `server/game/services/<Name>Service.js` exposing static methods
   that own one resource.
2. Route all mutations of that resource through it — never mutate the
   resource field anywhere else.
3. Delegate through `GameState` when the service needs game-wide context
   (events, game-over, multiple players), or reference it directly when it
   operates on a single `playerState`.
