# Service Layer Architecture — Shinsu Duel

This document describes the authoritative resource services that own all state mutation in the game engine.

---

## Overview

The engine enforces a strict ownership rule: **if a service exists for a resource, nothing else mutates it.** Handlers, actions, engines, and attribute engines never touch resource fields directly — they delegate to the owning service. This keeps every mutation in one place, so validation, events, caps, and cleanup are always applied consistently and future mechanics cannot corrupt state by writing around the rules.

`GameState` is the orchestrator. It exposes thin delegation methods for services that need game-wide context (e.g. game-over detection) and keeps direct references for the rest.

| Service                | Resource                       | Mutation API                                                   |
| ---------------------- | ------------------------------ | -------------------------------------------------------------- |
| **ShinsuService**      | `playerState.shinsu`           | `reset`, `spend`, `gain`, `getTotal`, `canAfford`              |
| **ZoneService**        | `deck` / `hand` / `discard`    | `draw`, `discard`, `reclaimTop`, `removeFromHand`, `addToHand` |
| **CompressionService** | `card.costReduction`           | `compress`, `clearReduction`, `getReduction`                   |
| **CombatSlotService**  | `combatSlots` + `shinheuhSlot` | position slots + Shinheuh slot (see below)                     |
| **LighthouseService**  | `playerState.lighthouses`      | `modify` (cap 0–40, game-over at 0)                            |
| **UnitService**        | `unit.currentHp`               | `damage`, `heal`, `setHp` (clamped/capped)                     |

---

## ShinsuService

Owns the shinsu pools (`normalAvailable`, `normalSpent`, `recharged`). Spending deducts recharged first, then normal; gaining always adds to the normal pool. Reset carries over up to 2 unspent shinsu as recharged.

## ZoneService

Sole path for card movement between zones. `draw` emits `game:deck:empty` when the deck is exhausted; `removeFromHand` and `discard` clear a card's compression so it returns to base cost outside the hand. `removeFromHandById` and `removeFromDeckById` pull a specific card instance by id (used by the `discard` and `summon` effects, respectively); `searchDeck` additionally reshuffles for filtered draws.

## CompressionService

Owns per-card-instance cost reduction (`card.costReduction`). Compression stacks additively across sources. `clearReduction` is invoked by `ZoneService` when a card leaves the hand, so compression never persists into the discard pile or onto the battlefield.

```js
CompressionService.compress(card, 2, context); // → { compressed, totalReduction }
CompressionService.clearReduction(card);
```

## CombatSlotService

Owns **all** combat slots: the five position slots plus the Shinheuh slot. Position slots reset each round and are consumed by non-Free ability use. The Shinheuh slot operations (grant/consume/reset) are driven by the Anima engine, which only decides when they happen — see `ATTRIBUTE_SYSTEM_ARCHITECTURE.md`.

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

Owns the lighthouse life total. `modify` clamps to 0–40, and reaching 0 sets `gameState.gameOver` and emits `game:lighthouses:depleted` + `game:over`. `GameState.modifyLighthouses()` is a thin wrapper that forwards to it.

## UnitService

Owns a unit's combat HP (`unit.currentHp`). `damage` clamps to remaining HP, `heal` caps at `card.maxHp`, and `setHp` floors at 0 — every write to a unit's HP goes through one of these. The service is pure math and emits no events; callers (`DealDamageHandler`, `HealHandler`, the Undying lifecycle hook, `LifecycleEngine.transformUnit`) emit the damage/heal events themselves.

```js
UnitService.damage(unit, amount); // → { applied, currentHp }
UnitService.heal(unit, amount); // → { healed, currentHp }
UnitService.setHp(unit, value); // → currentHp (floored at 0)
```

## PredicateEvaluator

Pure, read-only evaluator for the predicates that gate `conditional` nodes and always-on modifiers. `evaluate(predicate, gameState, extra)` dispatches on `predicate.type` — `has_unit`, `alone_on_line`, `started_with_card`, `has_equipped`, `has_all_equipped`, `has_condition` — applies the optional `negate`, and returns a boolean. It owns no resource and mutates nothing: board existence checks delegate to `TargetResolver.resolveExistenceUnits`, equipment checks read `unit.equipmentAttachments`, and deck checks read the `GameState` starting-deck snapshot via `startedWithCard`.

## ModifierService

Owns always-on modifier application (`modify_stat`/`modify_cost`/`modify_condition`/`modify_keyword`/`modify_targeting`/`modify_repeat`/`retain_equipment`/`modify_ability`) as source-keyed `ModifierStack` entries, applied by `PassiveManager` and `LifecycleEngine`. It exposes `revokeBySource(gameState, sourceId)` as the symmetric revoke counterpart to `applyModifier`, and enforces a modifier's node-level `position` (the source unit must occupy that position) at application time. It is also the **single cost authority** for playing/deploying/equipping: `getEffectiveCost(card, owner, gameState)` folds a card's base cost, its own `modify_cost` effects (predicate-gated against the acting player), and board-wide `stat: cost` modifiers keyed to the owner and filtered by `cardType`/affiliations. Every action (`PlaySkillAction`, `DeployUnitAction`, `EquipEquipmentAction`) and `LifecycleEngine` cost check routes through it. See `MODIFIER_STACK_ARCHITECTURE.md` for the consultation helpers.

## GlobalRuleRegistry

Owns landmark `rules` as source-keyed `ModifierStack` entries (`sourceType: "landmark"`, `sourceId: Landmark#<unitId>`, `type: "rule"`, `meta.rule`). `registerUnit(unit, gameState)` applies a landmark's rules when it enters play; `unregisterUnit(unitId, gameState)` revokes them by source when it leaves. Rules are **not** modifiers — `ModifierService.isModifier` excludes them — and are applied by `LifecycleEngine` on deploy, mirroring `PassiveManager` but for the always-on board-wide rule contract.

---

## Integration

- **Handlers** delegate shared-resource changes (see `HANDLER_SYSTEM_ARCHITECTURE.md`).
- **PassiveManager** registers timed (`round_start`/`round_end`) and always-on (`conditional`) passives as event subscriptions and resolves them through `EffectResolver`; it coordinates state change rather than owning a resource (see `PASSIVE_SYSTEM_ARCHITECTURE.md`).
- **Actions** validate via the same services before mutating (see `ACTION_SYSTEM_ARCHITECTURE.md`).
- **LifecycleEngine** composes them for deploy/destroy/equip, owns position movement via `switchPosition`, and adds the lifecycle primitives `killUnit` (shared lethal pipeline for `slay` and lethal damage), `summonUnit`, `stealUnit`, `discardEquipment`, and `_detachOne` (single equipment detach/routing).
- **Attribute engines** mutate only through `GameState` delegation (`CombatSlotService` for the Shinheuh slot, `_modifyFireCharges` for fire charges), never by writing resource fields directly.

## Adding a New Service

1. Create `server/game/services/<Name>Service.js` exposing static methods that own one resource.
2. Route all mutations of that resource through it — never mutate the resource field anywhere else.
3. Delegate through `GameState` when the service needs game-wide context (events, game-over, multiple players), or reference it directly when it operates on a single `playerState`.
