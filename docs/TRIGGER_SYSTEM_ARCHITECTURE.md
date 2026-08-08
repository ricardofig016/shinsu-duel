# Trigger System Architecture — Shinsu Duel

This document describes the compile-time trigger AST system and runtime trigger management for evolution and ignition transformations.

---

## Overview

The trigger system has two layers:

| Layer        | Location                                   | Purpose                                                 |
| ------------ | ------------------------------------------ | ------------------------------------------------------- |
| **Compiler** | `scripts/card-compile.js` `parseTrigger()` | Converts raw trigger text to typed ASTs at compile time |
| **Runtime**  | `server/game/services/TriggerManager.js`   | Maps typed ASTs to EventBus subscriptions               |

**Critical design constraint:** The runtime never parses raw trigger text.
If a trigger pattern is not recognized by `parseTrigger()`, compilation
fails. This forces explicit modeling of every trigger type.

---

## Trigger AST Types

| `type`             | Canonical pattern                         | Runtime event                         |
| ------------------ | ----------------------------------------- | ------------------------------------- |
| `equip`            | "i am equipped with X" / "equip with X"   | `equipment:attached`                  |
| `equip` (position) | "Fisherman: equip with X"                 | `equipment:attached` + position check |
| `slay`             | "the bearer Slays a unit"                 | `unit:killed`                         |
| `deploy`           | "when i am deployed"                      | `unit:summoned`                       |
| `given`            | "when I am given X" / "X is played on me" | `skill:applied`                       |
| `kill`             | "when i kill a Ranker"                    | `unit:killed`                         |
| `ally_dies`        | "when an ally dies"                       | `unit:destroyed`                      |
| `damaged_by`       | "when i am damaged by X"                  | `unit:damage:applied`                 |

### AST Object Shape

```json
{
  "type": "equip",
  "cardName": "Ice Spear",
  "raw": "i am equipped with Ice Spear"
}
```

Position-scoped variant:

```json
{
  "type": "equip",
  "cardName": "Karaka's Armor Suit",
  "position": "fisherman",
  "raw": "Fisherman: equip with Karaka's Armor Suit"
}
```

---

## Compiler Integration

`parseTrigger(raw)` is called during `resolveEvolveInto()` and
`resolveIgniteInto()` in `scripts/card-compile.js`. It converts
`{ type: "custom", raw, handler: null }` trigger objects into typed ASTs.

**Adding a new trigger pattern:**

1. Add the regex match to `parseTrigger()` in `scripts/card-compile.js`
2. Add an AST type constant
3. Add a handler method to `TriggerManager._subscribeTrigger()`
4. Recompile: `npm run compile:cards`

---

## Runtime TriggerManager

`TriggerManager` subscribes to EventBus events matching each trigger AST
type. When the event fires, it checks the payload against the trigger
conditions (card name matches, position matches, etc.) and if satisfied,
calls `LifecycleEngine.transformUnit()` for evolution or
`LifecycleEngine.transformEquipment()` for ignition.

### Registration

```js
triggerManager.registerTransformation(
  unitId, // the unit that will transform
  triggers, // typed AST array from compiler
  targetCardId, // card to transform into
  "evolution", // or "ignition"
  gameState,
  equipmentId, // ignition only — which attached card instance this trigger belongs to
);
```

**`equipmentId` disambiguates ignition triggers when a bearer holds more
than one equipment card (Irregular units).** Without it, killing a unit
while holding two ignitable equipments would be ambiguous about which one
ignites. It's `null` for evolution, which always targets the unit itself.

### Subscription cleanup

When a unit transforms or is destroyed, all its trigger subscriptions
are removed via `unregisterAll(unitId)`. Detaching a single equipment card
removes only that card's subscriptions via `unregisterAll(unitId, "ignition", equipmentId)`.

---

## Evolution vs Ignition

| Property         | Evolution                                 | Ignition                       |
| ---------------- | ----------------------------------------- | ------------------------------ |
| Source           | Unit card `evolveInto`                    | Equipment card `igniteInto`    |
| Trigger owner    | The unit itself                           | The equipment's bearer         |
| Transform target | Evolved unit card                         | Ignited equipment card         |
| State preserved  | HP delta, conditions, equipment, position | Equipment effects are replaced |

### Ignition revert

When an ignited equipment is detached (bearer dies or equipment replaced),
the equipment reverts to its base form when returned to hand.
