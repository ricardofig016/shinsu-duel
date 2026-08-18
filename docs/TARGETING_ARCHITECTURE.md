# Targeting Architecture — Shinsu Duel

This document describes the canonical target resolution system: line blocking rules, taunt/ghost/sharpshooter interactions, and the pending-decision protocol.

---

## Overview

`TargetResolver.resolveTargets(gameState, options)` is the **sole authority** for resolving human-readable target descriptors into validated unit lists. `EffectResolver` is the integration boundary: it calls `TargetResolver`, converts resolved targets into concrete `targetId` payloads, and only then invokes a handler. Handlers never accept or interpret target descriptors.

---

## Valid Target Descriptors

| Descriptor          | Behavior                                               |
| ------------------- | ------------------------------------------------------ |
| `self`              | The source unit itself                                 |
| `ally`              | One allied unit (excluding self)                       |
| `enemy`             | One enemy unit (frontline-first, taunt-constrained)    |
| `bearer`            | The equipment's bearer (resolved by caller)            |
| `all_allies`        | All allied units                                       |
| `all_enemies`       | All enemy units (frontline-first)                      |
| `enemies`           | Player-selected enemy targets, constrained by Taunt    |
| `enemy_frontline`   | Enemy frontline units only                             |
| `enemy_backline`    | Enemy backline units only                              |
| `enemy_lighthouses` | Opponent lighthouses when only Ghost/no enemies remain |
| `unit`              | Any unit on either board                               |

---

## Targeting Rules (RULES.md)

### Frontline blocks backline

A unit can only target backline enemies if the enemy frontline is **empty** (no non-Ghost, alive units on frontline).

### Ghost bypass

Units with the **Ghost** condition don't count as blockers — enemies behind them can be targeted even when frontline is technically non-empty.

### Sharpshooter bypass

Units with the **Sharpshooter** trait ignore line restrictions entirely — they can target any enemy regardless of frontline/backline.

### Taunt enforcement

Taunt applies only to effects originating from an **enemy unit**. It does not constrain targetable skills. A single-target effect MUST target a valid Taunt unit. For a player-selected multi-target effect, every valid Taunt unit must be selected before any other enemy unit may be selected. Effects that unconditionally target all enemies do not require a choice and include all valid enemies.

### Blinded

A unit with the `Blinded` condition cannot choose targeted units. For choice descriptors such as `enemy`, `ally`, and `unit`, `TargetResolver` shuffles the already-filtered valid candidates and selects from that order. Line blocking, Ghost, Sharpshooter, Taunt, and other filters are applied before randomization. Self, bearer, all-target descriptors, and lighthouse targeting are not randomized. The resolver uses the game's seeded RNG so random targeting is deterministic in tests and replays.

---

## Optional Filters

| Filter           | Example                                                       |
| ---------------- | ------------------------------------------------------------- |
| `condition`      | Only units with this condition: `"rooted"`                    |
| `conditionValue` | Threshold: `condition: "burned", conditionValue: 2`           |
| `trait`          | Only units with this trait: `"taunt"`                         |
| `rank`           | Only units of this rank: `"ranker"` (array = OR)              |
| `position`       | Only units at this position: `"fisherman"` (array = OR)       |
| `affiliation`    | Only units with this affiliation: `"team-chang"` (array = OR) |
| `attribute`      | Only units with this attribute: `"hwayeomsa"` (array = OR)    |
| `name`           | Only units with this exact name: `"Conduit"`                  |
| `count`          | Max targets: `count: 2` for "2 enemies"                       |

---

## Structured Target Descriptors

Compiled cards author unit targets as structured objects — `{ side, scope, count, ...filters }` — rather than string descriptors. `EffectResolver` translates them through `TargetResolver.normalizeStructuredTarget()` into the canonical string target plus filter fields before resolution, so handlers never receive an object target.

| Field   | Values                                                                                         |
| ------- | ---------------------------------------------------------------------------------------------- |
| `side`  | `self`, `bearer`, `ally`, `enemy`, `any` (`any` = `unit`)                                      |
| `scope` | `single`, `all`, `frontline`, `backline` (default `single`)                                    |
| `count` | Max targets (e.g. `count: 2`)                                                                  |
| filters | `condition`, `conditionValue`, `trait`, `rank`, `position`, `affiliation`, `attribute`, `name` |

`scope` maps `enemy`+`all` → `all_enemies`, `frontline` → `enemy_frontline`, `backline` → `enemy_backline`, `ally`+`all` → `all_allies`. `random`/`cost` selection and deck/hand/game sources are not yet supported and land in Phase D.

---

## Card-in-Hand Targeting

Some effects target cards still in the player's hand (e.g. `compress_shinsu`). These use `TargetResolver.resolveCardTarget(playerState, selector)` — the same architectural boundary as unit targeting.

| Selector                    | Behavior                                                 |
| --------------------------- | -------------------------------------------------------- |
| `"<card name>"`             | Exact card name match (case-insensitive)                 |
| `"the most expensive card"` | Highest printed-cost card in hand                        |
| `"a <attribute>"`           | First card with the given attribute (e.g. "a Hwayeomsa") |

`EffectResolver` pre-resolves `targetCardSelector` to a concrete `targetCardId` before invoking any handler. Handlers only receive `targetCardId` — they never interpret the selector string.

---

## Existence Checks (Predicates)

Predicates (`conditional` nodes and always-on passive gates) ask "does a matching unit exist?" rather than "who is a legal target?". `TargetResolver.resolveExistenceUnits(gameState, descriptor, sourceOwner)` answers this for the `has_unit` and `has_condition` predicates: it collects every alive unit on the requested side and applies the same filter vocabulary as `resolveTargets` through the shared `applyFilters` helper.

Key differences from offensive targeting:

- Existence checks ignore line blocking, Taunt, Blinded, and Sharpshooter — they only test presence, not target legality.
- `side` is restricted to `ally`, `enemy`, or `any` (`self`/`bearer` are not existence sides).
- A matching source unit counts toward the check ("an allied Guide" on a Guide unit includes itself).
- `scope`, `count`, `choose`, `random`, and `cost` are not valid on predicate targets — the `predicateTarget` schema rejects them.

`applyFilters` is the single source of truth for the unit-filter vocabulary (`condition`, `conditionValue`, `trait`, `rank`, `position`, `affiliation`, `attribute`, `name`). Both `resolveTargets` and `resolveExistenceUnits` delegate to it, so targeting and existence filters never diverge.

---

## Pending-Decision Protocol

When an effect requires player choice (multi-target, overflow destruction choice, etc.), the engine emits a `pending-decision` event and pauses:

```js
// Engine emits
gameState.eventBus.emit("pending-decision", {
  decisionId: "decision#1", // generated by IdFactory.decisionId()
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

The engine validates choices and resumes the event chain. Validation includes the decision ID, owner, choice count, uniqueness, candidate membership, and whether a real unit candidate was destroyed while the decision was pending. Decisions stack. If a resolution creates a second choice while one is still pending, the active decision is pushed aside and the new one becomes current; resolving it pops the previous one back and re-emits `pending-decision` for it. Clients always resolve exactly one choice at a time.
