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
| `ally`              | One allied unit (including self)                       |
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

Taunt applies only to effects originating from an **enemy unit**. It does not constrain targetable skills. A single-target effect MUST target a valid Taunt unit. A multi-target effect (`{ side: enemy, count: N }`, normalized to the `enemies` descriptor) locks every targetable Taunt unit as **mandatory**; the player chooses only the remaining free (non-Taunt) slots, and only if more free candidates exist than slots remain. Effects that unconditionally target all enemies do not require a choice and include all valid enemies.

Multi-target enemy selection goes through `TargetResolver.resolveTargetSelection()`, which returns either a complete auto-selection (`{ auto: true, ids }`) or a decision plan (`{ auto: false, lockedIds, freeCandidates, freeCount }`). It auto-selects when there is no genuine choice: when the Taunt units already satisfy the count, when every remaining candidate is forced, or when `random`/Blinded picks the free slots automatically. When there are more targetable Taunt units than slots, the player chooses `count` among them. The same planner drives every choice descriptor (`enemy`, `enemies`, `enemy_frontline`, `enemy_backline`, `unit`, `ally`), so line-scoped and any-unit effects enforce Taunt exactly like plain `enemy` targeting.

### Blinded

A unit with the `Blinded` condition cannot choose targeted units — its targets are chosen at random among legal targets. `TargetResolver` shuffles the already-filtered valid candidates for choice descriptors (`enemy`, `enemies`, `ally`, `unit`, `enemy_frontline`, `enemy_backline`) before selection. `EffectResolver` then **auto-selects** the requested count rather than creating a decision, and `resolveTargetSelection` randomizes the free slots of a multi-target enemy selection. Line blocking, Ghost, Sharpshooter, Taunt, and other filters are applied before randomization, so Taunt is still enforced for a Blinded source. Self, bearer, all-target descriptors, and lighthouse targeting are not randomized. The resolver uses the game's seeded RNG so random targeting is deterministic in tests and replays.

### Modifier targeting rules

Always-on `modify_targeting` entries (read through `ModifierStack.getTargetingRules`) shape legality: `ignore_taunt` lets the source unit bypass Taunt entirely (checked before the Taunt filter is applied), and `untargetable_by` removes candidates whose stored blocked-actor filter matches the source unit (e.g. "units with Burned 3+ can't target me"). Both are keyword overrides applied by `ModifierService`, so they revoke with their source and are evaluated with the same filter vocabulary as every other target filter.

---

## Structured Target Descriptors

Compiled cards author unit targets as structured objects — `{ side, scope, count, ...filters }` — rather than string descriptors. The field grammar (`side`, `scope`, `count`, `choose`, `random`, the filter vocabulary, and `sequence` link targets) is defined in the [Target grammar](COMPILED_CARD_DSL.md#target-grammar) section of `COMPILED_CARD_DSL.md`. `EffectResolver` translates them through `TargetResolver.normalizeStructuredTarget()` into the canonical string target plus filter fields before resolution, so handlers never receive an object target.

`scope` maps `enemy`+`all` → `all_enemies`, `frontline` → `enemy_frontline`, `backline` → `enemy_backline`, `ally`+`all` → `all_allies`, and `ally`+`frontline`/`backline` → `ally` with a `line` filter (ally line scope is honored, not dropped). `choose` and `random` are selection strategies applied after filtering; `random` uses the game's seeded RNG so it is deterministic in tests and replays. Card targets resolve through `resolveCardTargets` (see [Card Target Resolution](#card-target-resolution)).

---

## Card Target Resolution

Some effects target cards rather than units on the field (e.g. `compress_shinsu`, filtered `draw_card`/`reclaim_cards`, and `create_card`). These use `TargetResolver.resolveCardTargets(cards, descriptor)` — the same architectural boundary as unit targeting. `cards` is a list of normalized card views produced by `toCardTargetView` (in `utils/cardData.js`), which collapses the `Card` instance's code→entry dictionaries and the compiled catalog's code arrays into one filter shape. The `card` target field grammar is in the [Target grammar](COMPILED_CARD_DSL.md#target-grammar) section of `COMPILED_CARD_DSL.md`.

`EffectResolver` resolves the source zone from `card.zone` when present, else derives it from the effect type (`create_card` resolves the card catalog in its handler). It pre-resolves the structured `card` target to a concrete `targetCardId` (or a `card_selection` decision for `choose`) before invoking any handler. Handlers only receive `targetCardId` — they never interpret the card target themselves.

---

## Existence Checks (Predicates)

Predicates (`conditional` nodes and always-on passive gates) ask "does a matching unit exist?" rather than "who is a legal target?". `TargetResolver.resolveExistenceUnits(gameState, descriptor, sourceOwner)` answers this for the `has_unit` and `has_condition` predicates: it collects every alive unit on the requested side and applies the same filter vocabulary as `resolveTargets` through the shared `applyFilters` helper.

Key differences from offensive targeting:

- Existence checks ignore line blocking, Taunt, Blinded, and Sharpshooter — they only test presence, not target legality.
- `side` is restricted to `ally`, `enemy`, or `any` (`self`/`bearer` are not existence sides).
- A matching source unit counts toward the check ("an allied Guide" on a Guide unit includes itself).
- `scope`, `count`, `choose`, `random`, and `cost` are not valid on predicate targets — the `predicateTarget` schema rejects them.

`applyFilters` is the single source of truth for the unit-filter vocabulary (`condition`, `conditionValue`, `trait`, `traitNot`, `rank`, `position`, `affiliation`, `attribute`, `name`, `cost`, `sharedAffiliation`, `lowestHp`, `hasPassive`, `canSwitch`, `kind`, `line`). The `excludeSelf` flag is applied in the `ally` descriptor case (not in `applyFilters`), since existence checks share `applyFilters` with a null source unit and must stay self-inclusive. Both `resolveTargets` and `resolveExistenceUnits` delegate to it, so targeting and existence filters never diverge.

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
  lockedIds: ["Unit#3"], // auto-selected mandatory targets (Taunt), already resolved
});

// Client sends
socket.emit("game-decision", {
  decisionId: "d_42",
  choices: ["Unit#5", "Unit#7"],
});
```

A decision is created **only when there is a genuine choice**: when the number of legal candidates equals (or is fewer than) the requested count, when every target is forced (e.g. Taunt), when the effect declares `random`, or when the source is `Blinded`, the engine auto-selects and does not pause. `lockedIds` carries targets that are already committed (mandatory Taunt units) so clients can render them as pre-selected; the player's `choices` cover only the remaining `minChoices..maxChoices` slots.

The engine validates choices and resumes the event chain. Validation includes the decision ID, owner, choice count, uniqueness, candidate membership, and whether a real unit candidate was destroyed while the decision was pending. Decisions stack. If a resolution creates a second choice while one is still pending, the active decision is pushed aside and the new one becomes current; resolving it pops the previous one back and re-emits `pending-decision` for it. Clients always resolve exactly one choice at a time.
