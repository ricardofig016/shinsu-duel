# Targeting Architecture — Shinsu Duel

This document describes the canonical target resolution system: line blocking
rules, taunt/ghost/sharpshooter interactions, and the pending-decision protocol.

---

## Overview

`TargetResolver.resolveTargets(gameState, options)` is the **sole authority**
for resolving human-readable target descriptors into validated unit lists.
All handlers must use it — no ad-hoc target logic.

---

## Valid Target Descriptors

| Descriptor | Behavior |
|---|---|
| `self` | The source unit itself |
| `ally` | One allied unit (excluding self) |
| `enemy` | One enemy unit (frontline-first, taunt-constrained) |
| `bearer` | The equipment's bearer (resolved by caller) |
| `all_allies` | All allied units |
| `all_enemies` | All enemy units (frontline-first, taunt ignored for mass) |
| `enemy_frontline` | Enemy frontline units only |
| `enemy_backline` | Enemy backline units only |
| `unit` | Any unit on either board |

---

## Targeting Rules (RULES.md)

### Frontline blocks backline

A unit can only target backline enemies if the enemy frontline is **empty**
(no non-Ghost, alive units on frontline).

### Ghost bypass

Units with the **Ghost** condition don't count as blockers — enemies behind
them can be targeted even when frontline is technically non-empty.

### Sharpshooter bypass

Units with the **Sharpshooter** trait ignore line restrictions entirely —
they can target any enemy regardless of frontline/backline.

### Taunt enforcement

If any enemy on the valid target list has **Taunt**, single-target effects
MUST target the taunting unit. Sharpshooter bypasses this. Mass-target
effects (all_enemies, all_allies) ignore taunt.

---

## Optional Filters

| Filter | Example |
|---|---|
| `condition` | Only units with this condition: `"rooted"` |
| `conditionValue` | Threshold: `condition: "burned", conditionValue: 2` |
| `trait` | Only units with this trait: `"taunt"` |
| `rank` | Only units of this rank: `"ranker"` |
| `position` | Only units at this position: `"fisherman"` |
| `count` | Max targets: `count: 2` for "2 enemies" |

---

## Pending-Decision Protocol

When an effect requires player choice (multi-target, overflow destruction
choice, etc.), the engine emits a `pending-decision` event and pauses:

```js
// Engine emits
gameState.eventBus.emit("pending-decision", {
  decisionId: "d_42",
  type: "target_selection",
  candidates: [{ id, name, hp }, ...],
  minChoices: 1,
  maxChoices: 2,
});

// Client sends
socket.emit("game-decision", {
  decisionId: "d_42",
  choices: ["Unit#5", "Unit#7"],
});
```

The engine validates choices and resumes the event chain.
