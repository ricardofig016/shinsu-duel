# Handler System Architecture — Shinsu Duel

This document describes the handler pattern, registry, and DSL-to-handler mapping that resolves card effects into state mutations.

---

## Overview

All card effects — abilities, passives, equipment effects, skill effects, evolution triggers, and ignition triggers — are resolved by **handler classes** that extend `BaseHandler`. Handlers receive a structured payload, validate it, and execute state changes through the `ModifierStack` and `EventBus`.

Target descriptors are resolved before handler execution by `EffectResolver`/`TargetResolver`. Handlers receive concrete `targetId` values and must not resolve targets themselves.

Handlers never mutate `playerState` fields directly. Shared-resource changes delegate to the authoritative services:

| Resource       | Service / method                                 |
| -------------- | ------------------------------------------------ |
| Shinsu         | `ShinsuService.spend` / `ShinsuService.gain`     |
| Card zones     | `ZoneService.draw` / `discard` / `reclaimTop`    |
| Compression    | `CompressionService.compress` / `clearReduction` |
| Combat slots   | `CombatSlotService.consume` / `resetAll`         |
| Lighthouses    | `GameState.modifyLighthouses`                    |
| Unit HP        | `UnitService.damage` / `heal` / `setHp`          |
| Skill plays    | `SkillPlayService.play`                          |
| Unit modifiers | `ModifierStack`                                  |

| Concept           | Implementation                                                             |
| ----------------- | -------------------------------------------------------------------------- |
| Handler contract  | `BaseHandler` with `validate()` + `execute()`                              |
| Registration      | `HandlerRegistry` maps DSL `type` → handler instance                       |
| Nested DSL        | `spend_shinsu` wraps an inner `effect`; `grant_ability` wraps an `ability` |
| Cascading effects | `context.emitChild()` triggers downstream events                           |

`SkillPlayService.play(gameState, context, { card, effects?, owner, extra? })` is the single definition of "play a skill": it announces `SKILL_APPLIED` as `{ owner, cardName, card }` through `context.emitChild`, then resolves the card's effect nodes with the caller's `extra`. Both the player path (`PlaySkillAction`) and synthetic plays (`PlayJeonsulBaangHandler`) delegate to it, so every `SKILL_APPLIED` subscriber sees the same payload shape. Synthetic plays get full play visibility — including `skill_played` synergies — but belong to the passive layer: they pay no cost, touch no hand, discard nothing, end no turn, consume no repeat queues, and never call `recordCardPlayed`, so the round-start play tracker does not count them.

---

## BaseHandler Contract

```js
// server/game/handlers/BaseHandler.js

export default class BaseHandler {
  /**
   * Validate the payload. Throw on invalid input.
   * Called BEFORE execute. Prevents partial state mutations.
   */
  validate(payload, context) {
    // Override in subclasses. Default: pass-through.
  }

  /**
   * Execute the effect. Return a result object.
   * Use context.emitChild() for cascading effects.
   * Use gameState.modifierStack for state changes.
   * NEVER mutate gameState directly.
   */
  execute(payload, context, gameState) {
    throw new Error("execute() must be implemented by subclass");
  }
}
```

**⚠️ The validate/execute split is critical.** Validation failures must throw before any state mutation occurs. A handler that mutates state during validation, then throws, leaves the game in a corrupt state.

**⚠️ `context` is the EventContext from EventBus.** It provides:

- `context.emitChild(eventName, payload)` — DFS child event
- `context.cancel(reason)` — cancel the current event
- `context.eventName`, `context.phase`, `context.depth` — read-only metadata

---

## Handler Registry

```js
// server/game/registries/handlerRegistry.js

const registry = new HandlerRegistry();

registry.register("deal_damage", DealDamageHandler);
registry.register("heal", HealHandler);
registry.register("grant_trait", GrantTraitHandler);
// ...

registry.has("deal_damage"); // → true
registry.get("deal_damage"); // → DealDamageHandler instance
registry.get("deal_damage").execute(payload, ctx, gameState);
```

**⚠️ `register()` instantiates the handler class.** All handlers are singletons — they hold no per-invocation state. If a handler needs per-effect state, pass it in the payload.

**⚠️ The registry key is the DSL `type` field** from the compiled `cards.json`. This is the bridge between the compiler and the runtime engine.

**Inspection.** `initEffectResolver()` returns the initialized registry; `registry.names()` lists every registered DSL `type`. The shipped-data audit uses this to report dispatchable types with no handler.

**Structural vs dispatchable.** `sequence` and `conditional` never reach the registry — `EffectResolver` resolves them recursively. `schemas/dsl-catalog.json` records the owner category of every `type`; the contract tests fail if a structural type is registered as a handler or a dispatchable type has no owner (see [`COMPILED_CARD_DSL.md`](./COMPILED_CARD_DSL.md)).

---

## DSL-to-Handler Mapping

The compiled `cards.json` contains effect objects like:

```json
{
  "type": "deal_damage",
  "amount": 7,
  "target": "enemy",
  "raw": "deal 7 to an enemy"
}
```

At runtime, the resolution engine:

1. Reads `effect.type` → `"deal_damage"`
2. Resolves any target descriptor through `TargetResolver`
3. Looks up `registry.get("deal_damage")` → `DealDamageHandler`
4. Calls `handler.validate(payload)` with concrete `targetId` values
5. Calls `handler.execute(payload, context, gameState)`

A `type` with **no registered handler** makes `resolveEffect` throw `EffectResolver: unknown effect type "<type>"`. Resolution is structural only: the resolver never parses prose as a fallback.

---

## Handler Catalog

Handlers are grouped by the domain they mutate.

### Resource & card economy

| Handler                 | DSL `type`        | Key behavior                                                                            |
| ----------------------- | ----------------- | --------------------------------------------------------------------------------------- |
| `ChargeShinsuHandler`   | `charge_shinsu`   | Delegates to `ShinsuService.gain`; capped at round max; emits `shinsu:charged`          |
| `SpendShinsuHandler`    | `spend_shinsu`    | Delegates to `ShinsuService.spend`; recharged first, then normal                        |
| `CompressShinsuHandler` | `compress_shinsu` | Delegates to `CompressionService.compress`; receives `targetCardId` from EffectResolver |
| `ReclaimCardsHandler`   | `reclaim_cards`   | Delegates to `ZoneService.reclaimTop`; emits `card:reclaimed`                           |
| `LightUpHandler`        | `light_up`        | Delegates to `GameState.modifyLighthouses` (cap 40)                                     |
| `ExtinguishHandler`     | `extinguish`      | Delegates to `GameState.modifyLighthouses` (floor 0); emits `game:lighthouses:depleted` |
| `DrawCardHandler`       | `draw_card`       | Delegates to `ZoneService.draw`; emits `game:deck:empty` on exhaustion                  |
| `CreateCardHandler`     | `create_card`     | Creates a card in hand (`card:created`); `generated_by` families delegate to the engine |

### Combat & unit state

| Handler                   | DSL `type`           | Key behavior                                                                                                                                    |
| ------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `DealDamageHandler`       | `deal_damage`        | Barrier → Resilient → Weak → `UnitService.damage` → kill check via `LifecycleEngine.killUnit`; applies `stat: damage`/`damage_taken` amplifiers |
| `HealHandler`             | `heal`               | Applies healing via `UnitService.heal`, capped at max HP; applies `stat: heal` amplifier                                                        |
| `ActivateHandler`         | `activate`           | Emits `unit:activation` `amount` times (default 1) per live target, re-firing its `activation`-triggered passives and transformations           |
| `PlayJeonsulBaangHandler` | `play_jeonsul_baang` | Plays `floor(currentHp / 2)` random Baangs on random other friendly units via `SkillPlayService`; the passive's Conduit comes from `sourceUnit` |
| `GrantTraitHandler`       | `grant_trait`        | `stack.apply({ type:"trait", key, value })`                                                                                                     |
| `RemoveTraitsHandler`     | `remove_traits`      | Removes all traits or one named `trait` (Silence)                                                                                               |
| `CopyTraitsHandler`       | `copy_traits`        | Copies every active trait from `sourceUnitId` onto the target                                                                                   |
| `GrantRandomTraitHandler` | `grant_random_trait` | Grants a seeded-random trait (optional `numeric` pool filter)                                                                                   |
| `GrantAffiliationHandler` | `grant_affiliation`  | Grants one affiliation from the donor's pool (native + granted) as a source-tracked ModifierStack entry; donor pre-resolved into `sourceUnitId` |
| `GiveConditionHandler`    | `give_condition`     | Respects Immune; `stack.apply({ type:"condition", ... })`; applies `modify_condition` amplifier                                                 |
| `RemoveConditionHandler`  | `remove_conditions`  | `stack.removeWhere(m => m.type === "condition" && keySet.has(m.key))`                                                                           |

### Zone movement & lifecycle

| Handler                 | DSL `type`        | Key behavior                                                                                                  |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| `SummonHandler`         | `summon`          | Resolves `from` (deck/hand/deck_or_hand/game) + `onto`; places via `LifecycleEngine.summonUnit`               |
| `StealHandler`          | `steal`           | Moves a matching enemy unit onto the acting player's field via `LifecycleEngine.stealUnit`                    |
| `DiscardHandler`        | `discard`         | Discards a hand card (`targetCardId`) or bearer attachments (`zone: attachments`)                             |
| `DisarmHandler`         | `disarm`          | Detaches a unit's equipment and routes it by `to` (`{ zone, owner }`)                                         |
| `SwitchPositionHandler` | `switch_position` | Forces a unit to a legal other printed position; Rooted blocked; full lines excluded                          |
| `ChoosePositionHandler` | `choose_position` | Defers a `position_selection` decision for the source unit; the resolve stores `chosenPositionCode` and re-registers `position: "chosen"` rules via `GlobalRuleRegistry` |
| `SlayHandler`           | `slay`            | Kills via `LifecycleEngine.killUnit` (death-intent → `unit:killed` → destroy); Undying can intercept          |
| `TransformHandler`      | `transform`       | Replaces the source unit's card via `LifecycleEngine.transformUnit` (preserves HP delta/conditions/equipment) |
| `ReturnToHandHandler`   | `return_to_hand`  | Returns a unit to its owner's hand via `LifecycleEngine.returnUnitToHand`; not a kill or a discard            |

### Abilities & observation

| Handler               | DSL `type`      | Key behavior                                                                                                                  |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GrantAbilityHandler` | `grant_ability` | Registers inner ability via `AbilityRegistry`; revoked on source removal                                                      |
| `CopyAbilityHandler`  | `copy_ability`  | Resolves one of an enemy's abilities (`ability_selection` decision when several)                                              |
| `RepeatPlayHandler`   | `repeat_play`   | Queues extra plays of a card on `GameState` (consumed by `PlaySkillAction`); wildcard (any next card) when `cardName` omitted |
| `PeekHandHandler`     | `peek_hand`     | Reveals hand cards (observer-only); `card` filter + `mode`/`amount`/`random`                                                  |

### Markers

| Handler       | DSL `type` | Key behavior                                                |
| ------------- | ---------- | ----------------------------------------------------------- |
| `NoopHandler` | `noop`     | No-op; resolves to `{ resolved: true }` (test placeholders) |
| `NoopHandler` | `quick`    | Display-only Quick marker node; no-op                       |

Every effect type cataloged in `schemas/dsl-catalog.json` has a registered handler in the tables above. A structured type that reaches `resolveEffect` without a registered handler throws; the runtime-ownership test in `CardDataAudit.test.js` fails while any cataloged effect type has no registered handler. Always-on **modifiers** (`modify_*`/`retain_equipment`) are not handlers at all — they are applied as source-tracked `ModifierStack` entries by `ModifierService` and consumed through filter-aware consultation helpers (see `MODIFIER_STACK_ARCHITECTURE.md`). The structural nodes `sequence` and `conditional` are the exception — they are resolved by `EffectResolver` directly, not through a handler class (see below).

## Ability Registry

`server/game/registries/abilityRegistry.js` is the authoritative store for runtime-granted abilities (created by `grant_ability`). It holds the inner ability as a structured DSL object (not serialized JSON) with its provenance:

```js
gameState._abilityRegistry.grant(targetId, sourceId, sourceType, ability)
  → { code: "granted:<sourceId>:<type>", ability }

gameState._abilityRegistry.resolve(targetId, code)
  → { ability, sourceType, sourceId } | null
```

`UseAbilityAction` resolves granted ability codes through the registry (see `ACTION_SYSTEM_ARCHITECTURE.md`). AbilityRegistry cleanup is driven exclusively through the `ModifierStack.onRevoke` bridge: when a modifier of type `"ability"` is removed (by `removeBySource` on unequip, or `removeByTarget` on unit destroy), the bridge cascades to `AbilityRegistry.revokeBySource`. `LifecycleEngine` never calls `AbilityRegistry` directly — it cleans up through `ModifierStack` and the bridge handles the rest.

## EffectResolver

The `EffectResolver` is the recursive resolution engine that maps DSL objects to handlers:

```js
resolveEffect(effect, context, gameState, extra);
```

1. Resolves structural nodes directly: `sequence` runs its `steps` in order; `conditional` evaluates its `if` predicate via `PredicateEvaluator` and resolves the matching branch (`then`/`otherwise`).
2. Otherwise reads `effect.type` and looks up the handler via `HandlerRegistry`
3. Handles nested effects: `spend_shinsu.effect` resolved recursively after deduction
4. `grant_ability.ability` is stored by the GrantAbilityHandler, not resolved immediately
5. A `type` with no registered handler throws `EffectResolver: unknown effect type "<type>"`

---

## Nested DSL Resolution

Some compiled DSL types are **nested** — they contain inner effect objects that themselves need handler resolution.

### `spend_shinsu`

```json
{
  "type": "spend_shinsu",
  "amount": 1,
  "effect": {
    "type": "give_condition",
    "condition": "rooted",
    "amount": 2,
    "target": "enemy",
    "raw": "give Rooted to 2 enemies"
  }
}
```

Resolution flow:

1. `SpendShinsuHandler` validates and deducts shinsu
2. If successful, it resolves the inner `effect` by looking up its `type` in the registry
3. The inner effect may itself be nested (e.g., `spend_shinsu` wrapping `deal_damage`)

**Resolution recurses through the same function**:

```js
function resolveEffect(effect, context, gameState, extra = {}) {
  if (!registry.has(effect.type)) {
    throw new Error(`EffectResolver: unknown effect type "${effect.type}"`);
  }
  // TargetResolver is called here, before the handler, when effect.target
  // is a descriptor. The handler receives only concrete targetId values.
  const payload = { ...effect, ...extra };
  const handler = registry.get(payload.type);
  handler.validate(payload, context);
  return handler.execute(payload, context, gameState);
}
```

### `grant_ability`

```json
{
  "type": "grant_ability",
  "target": "bearer",
  "ability": {
    "type": "give_condition",
    "condition": "poisoned",
    "amount": 4,
    "target": "enemy",
    "raw": "give Poisoned 4 to an enemy"
  }
}
```

The inner `ability` is a full DSL object with its own `type`, `amount`, `target` etc. `GrantAbilityHandler` registers it in the `AbilityRegistry` (see the Ability Registry section) and records a `type: "ability"` `ModifierStack` marker keyed by the generated code.

The bearer's player can then use it through `UseAbilityAction`, addressed as `granted:<sourceId>:<type>` instead of a numeric ability index. Unequipping the source revokes the modifier and the registry entry, which makes the ability unusable again — no separate cleanup path is needed. The same cleanup occurs when the bearer is destroyed.

---

## Structural Nodes

`sequence` and `conditional` are compositional DSL nodes with **no handler class**. `EffectResolver` recognizes them before the registry lookup and resolves them recursively:

```json
{ "type": "sequence", "steps": [ /* effects */ ] }
{ "type": "conditional", "if": { "type": "has_unit", "target": {} }, "then": {}, "otherwise": {} }
```

- `sequence` resolves `steps` in order through the same pending-decision continuation used by `resolveEffects`, so a target choice in an early step never runs ahead of later mutations.
- `conditional` evaluates its `if` predicate via `PredicateEvaluator` (a pure, read-only service — see `SERVICE_LAYER_ARCHITECTURE.md`), then resolves `then` when true or `otherwise` when false. A missing branch is a legal no-op.

---

## Handler Payload Conventions

Every handler receives the DSL object as its payload (plus `context` and `gameState`). The payload contains all fields from the compiled effect:

```js
// deal_damage payload
{ type: "deal_damage", amount: 7, target: "enemy", raw: "deal 7 to an enemy" }

// give_condition payload
{ type: "give_condition", condition: "burned", amount: 1, target: "enemy" }

// spend_shinsu payload (nested)
{
  type: "spend_shinsu",
  amount: 2,
  effect: { type: "deal_damage", amount: 5, target: "enemy" },
  raw: "spend 2: deal 5 to an enemy"
}
```

**⚠️ The `raw` field is always present** — it's the original card text. Handlers can use it for logging/error messages but should NOT parse it for logic. Use the structured fields only.

---

## Anti-patterns

- **Don't parse `raw` text for logic** — use structured fields.
- **Don't skip validation** — always call `handler.validate()` before `execute()`.
- **Don't hold state in handler instances** — they're singletons.
- **Don't add a skip path for unknown effect types** — resolution throws so the gap surfaces immediately.
