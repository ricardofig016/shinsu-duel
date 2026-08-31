# GameState Architecture — Shinsu Duel

This document describes the GameState architecture: zone model, service layer, lifecycle engine, and snapshot/projection design.

---

## Overview

`GameState.js` is the authoritative runtime engine. It orchestrates all services and owns the complete game state tree. No handler, action, or engine mutates player-state resource fields directly — all resource mutations go through the owning service. `GameState` itself writes only its own orchestration fields (round, turn, pass state, game-over, pending decisions).

| Service                | Responsibility                                            |
| ---------------------- | --------------------------------------------------------- |
| **ShinsuService**      | Shinsu pool math: reset, spend, gain, total               |
| **ZoneService**        | Card movement: draw, discard, add/remove from hand        |
| **CompressionService** | Card cost compression (per card instance)                 |
| **CombatSlotService**  | Position and Shinheuh combat slots                        |
| **LighthouseService**  | Lighthouse life total (cap 40, game-over at 0)            |
| **UnitService**        | Unit combat HP: damage, heal, setHp                       |
| **LifecycleEngine**    | Unit lifecycle: deploy, destroy, transform, equip, move   |
| **TriggerManager**     | Evolution/ignition: AST→event subscriptions               |
| **PassiveManager**     | Triggered and always-on passives: DSL→event subscriptions |
| **GlobalRuleRegistry** | Landmark rules: always-on battlefield rule entries        |
| **AttributeRegistry**  | Pluggable attribute engines (Anima, Hwayeomsa, Jeonsulsa) |

### Landmark lifecycle

`LifecycleEngine` registers landmark rules when a landmark enters play and revokes its source when it leaves. It reconciles continuous landmark grants after deployment, transformation, movement, ownership changes, and landmark removal. `GameState` also reconciles after round-end condition cleanup, because a continuous `grant_global_condition` must return if its source landmark and target still qualify.

A `choose_position` landmark stores its selected code on `unit.chosenPositionCode`. Snapshots and serialized state include that field. The pending decision itself records only serializable candidate data and an internal owning-unit binding used for cancellation. `GlobalRuleRegistry` activates `position: "chosen"` rules only after the code exists and excludes Irregulars from every landmark-rule query. When a landmark leaves play, `LifecycleEngine` cancels its still-pending position choice so the game is not blocked on a decision whose source is gone; resolving a stale choice is a no-op.

Each service owns one resource; nothing outside the service mutates it. See `SERVICE_LAYER_ARCHITECTURE.md` for the full contract.

**Card catalog injection.** `GameState` resolves every card lookup (deck construction, `create_card`/`summon`/`transform` handlers, and the Hwayeomsa attribute engine) through an injectable catalog. The constructor accepts `options.cards`; when omitted it falls back to the compiled `server/data/cards.json`. Tests inject a stable fixture catalog (`server/game/tests/fixtures/cards.js`) so balance changes to shipped cards never affect implementation tests — only the catalog _contract_ (`schemas/compiled-cards.schema.json`) is shared.

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
| Unreachable cards                | Deck construction rejects them;                   |

---

## Pending Decisions

Some effects and actions require a player choice mid-resolution (target selection, line-overflow destruction). `GameState.createPendingDecision()` publishes the choice and blocks further `processAction()` calls until `resolveDecision()` is called with a validated selection. A decision carries an optional `lockedIds` list — targets that are already committed (mandatory Taunt units) and excluded from the player's own choices — surfaced to clients via `getClientState`, `toSerializedState`, and the `DECISION_PENDING` event. Callers must not create a decision when there is no genuine choice (candidates ≤ requested count, or a forced/random/Blinded selection): those resolve immediately. `cancelPendingDecisions(predicate)` drops pending decisions whose source left play (a landmark destroyed while its position choice is open), discarding their resolve callbacks and continuations and restoring the next stacked decision, if any.

### Resolution Lifecycle State

The engine tracks an explicit `ResolutionState`:

| State       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `IDLE`      | No pending decisions; accepting actions and normal event flow |
| `RESOLVING` | One or more pending decisions exist; actions are blocked      |

`hasUnresolvedDecisions()` exposes the current state. The state transitions `IDLE → RESOLVING` on `createPendingDecision()` and `RESOLVING → IDLE` when the last decision is resolved and no stacked decisions remain.

A line-overflow deployment is deferred: the card remains in hand and no shinsu is spent while its owner chooses. Resolving a field-unit choice destroys it before the card enters play; resolving the pending-card choice pays for and discards that card without ever exceeding the five-unit limit.

### Nested Decisions & Stacking

Decisions are **stacked** LIFO. When a resolve callback creates a new pending decision (e.g. an overflow destroy triggers a target-selection effect), the new decision becomes the active one — the resolving decision is **not** pushed to the stack since it's being cleaned up by the resolution's `finally` block. Decisions created outside of a resolve callback (while one is already pending) are pushed to the stack normally.

Nesting is capped at `MAX_RESOLUTION_DEPTH` (16) to prevent infinite decision loops from buggy resolution callbacks.

### Re-entrancy Guard

`resolveDecision()` is NOT re-entrant: calling it from within a resolve callback or `onResolved` continuation throws. Nested decisions must use `createPendingDecision()` instead. The `finally` block always cleans up the decision stack and transitions to `IDLE` when empty, even if the resolve callback throws.

Callers that still have work to do after the choice resolves — e.g. ending the turn, or resolving the next effect in a card's effect list — register a continuation instead of running that work inline:

```js
gameState.completeActionAfterDecision(() => {
  // Runs immediately if there's no pending decision, or once the
  // current one resolves. Multiple continuations queue in order.
  gameState.endTurn();
});
```

This guarantees an action never advances the turn (or a card never resolves its next effect) before the player's choice has actually changed state.

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

`unit.equipmentAttachments` is the canonical equipment representation. It contains every attached card instance.

---

## Unit Lookup

`GameState._findUnit(unitId)` resolves a unit by instance ID through an O(1) `_unitIndex` map, kept in sync by `LifecycleEngine` (`_indexUnit` on deploy, `_unindexUnit` on destroy). A linear scan over both fields serves as a fallback for unit-shaped test stubs that bypass the lifecycle engine.

---

## Client Projection

`getClientState(username)` builds the per-username view the net layer sends on every snapshot. It carries `round`, `currentTurn`, `gameOver`, and two seat projections:

- `you`: combat slot codes and slot status, deck and discard sizes, lighthouses, shinheuh slot, fire charges, full hand card views, field units, shinsu, pass-button state, and `pendingDecision` when the viewer owns it (`decisionId`, `type`, `candidates`, `minChoices`, `maxChoices`, `lockedIds`).
- `opponent`: combat slot codes, deck size, lighthouses, field units, hand, shinsu, and pass-button state. Hand cards are empty objects unless the card is marked visible, and the opponent's pending decision is never included.

Field units are projected with the runtime state a client renders: instance id, current HP, owner, placed and chosen position codes, conditions with their effective magnitudes from the `ModifierStack`, active runtime trait keys, and equipment attachment names. Your units additionally carry granted abilities with their registry codes. Printed card data (name, cost, traits, attributes, abilities, positions) comes along inside each unit's card view; the `attributes` codes drive attribute mechanics client-side, such as the Hwayeomsa fire-charge panel.

Locked decision candidates sit outside the candidates list: `lockedIds` are engine-committed picks (mandatory Taunt targets), the `minChoices`/`maxChoices` range counts only the free selections, and the engine prepends the locked ids itself when the decision resolves. The net layer wraps this view with the session revision counter; transport semantics are documented in `NET_PROTOCOL_ARCHITECTURE.md`.

---

## Snapshot Design

The engine exposes two capture functions to the Logger:

1. **`_createSnapshot()`** — the flat, cheap diff view, called before/after every root event. It includes per unit:
   - Active conditions per unit (from ModifierStack)
   - Active traits per unit (from ModifierStack)
   - Runtime-granted ability codes per unit (from AbilityRegistry)
   - Equipment attachments
   - Combat slot status, Shinheuh slot status, fire charges
   - Hand/deck/discard sizes, lighthouses, shinsu

2. **`toSerializedState()`** — the complete deterministic serialization for replay. It additionally captures ordered zone contents (deck/hand/discard card ids and runtime fields), the full `ModifierStack` and `AbilityRegistry` dumps, pending-decision metadata, ID/RNG/clock counters, and round-tracking sets — all deterministically sorted so identical states serialize to identical JSON.

`_createSnapshot()` is used for state diffs; `toSerializedState()` is used by the `InitialState`, `UserAction`, `UserDecision`, and `EventFailure` log entries and by `ReplayDriver`.
