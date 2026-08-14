# Attribute System Architecture — Shinsu Duel

This document describes the pluggable attribute engine system and the attribute implementations: Anima and Hwayeomsa.

---

## Overview

Attributes change core gameplay mechanics for specific units. Each attribute is an independent engine registered with the `AttributeRegistry`:

```js
const registry = new AttributeRegistry();
registry.register("anima", new AnimaEngine(eventBus));
registry.register("hwayeomsa", new HwayeomsaEngine(eventBus, cards));
```

When a unit is deployed, `GameState` calls:

```js
this._attributeRegistry.onUnitDeployed(unit, this);
```

Each engine subscribes to its own EventBus events and manages cleanup independently.

---

## Anima Engine

**Core mechanic (RULES.md):**

> Round start: gain a single-use Shinheuh combat slot if you don't already have one.

### State

Per-player: `shinheuhSlot: { available: boolean, used: boolean }` — owned by `CombatSlotService`; the engine only decides _when_ to grant.

### Lifecycle

1. **Round start:** If an Anima unit is on the field and no Shinheuh slot exists, `AnimaEngine` asks `CombatSlotService.grantShinheuhSlot()` to create one (`available = true`).
2. **Shinheuh ability use:** `AnimaEngine.consumeSlot()` delegates to `CombatSlotService.consumeShinheuhSlot()` (`available = false, used = true`).
3. **Round end:** `CombatSlotService.resetShinheuhSlot()` clears both flags.

All Shinheuh slot mutations go through `CombatSlotService` — the engine never touches `playerState.shinheuhSlot` directly.

### API

```js
// Called by GameState when Anima unit is deployed
animaEngine.onDeploy(unit, gameState);

// Called when a Shinheuh uses an ability (delegates to CombatSlotService)
AnimaEngine.consumeSlot(owner, gameState) → boolean;

// Called at round end (delegates to CombatSlotService)
AnimaEngine.resetSlot(owner, gameState);

// Called when unit leaves play
animaEngine.cleanup(unit);
```

---

## Hwayeomsa Engine

**Core mechanic (RULES.md):**

> Spend 1, Free: gain 1 Fire Charge, create Fire Core in hand.
> Fire Core: Quick — consume Fire Charges to create Incinerate I-IV.

### State

Per-player: `fireCharges: number` — mutated only through `GameState._modifyFireCharges(username, delta)`.

### Fire Charge Generation

```js
hwayeomsaEngine.generateFireCharge(username, gameState)
  → { success: boolean, charges: number, reason?: string }
```

Validates: Hwayeomsa unit on field, sufficient shinsu (1). Creates Fire Core card in hand if not already present.

### Incinerate Consumption

```js
hwayeomsaEngine.consumeCharges(username, level, gameState)
  → Card | null
```

Levels:
| Level | Name | Charges |
|---|---|---|
| 1 | Incinerate I | 1 |
| 2 | Incinerate II | 3 |
| 3 | Incinerate III | 5 |
| 4 | Incinerate IV | 7 |

### Available levels query

```js
hwayeomsaEngine.getAvailableLevels(username, gameState)
  → [{ level: 1, name: "Incinerate I", chargesNeeded: 1 }, ...]
```

---

## Extending: Adding a New Attribute

1. Create `server/game/attributes/<name>Engine.js` with:
   - `onDeploy(unit, gameState)` — subscribe to events
   - `cleanup(unit)` — unsubscribe

2. Register in `GameState` constructor:

   ```js
   this._attributeRegistry.register(
     "jeonsulsa",
     new JeonsulsaEngine(this.eventBus),
   );
   ```

3. No changes needed to `LifecycleEngine` or `GameState` — the registry pattern handles everything generically.

---

## Attribute List

| Attribute | Engine               |
| --------- | -------------------- |
| Anima     | `AnimaEngine.js`     |
| Hwayeomsa | `HwayeomsaEngine.js` |
