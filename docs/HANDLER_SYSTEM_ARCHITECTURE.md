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
| Unit modifiers | `ModifierStack`                                  |

| Concept           | Implementation                                                             |
| ----------------- | -------------------------------------------------------------------------- |
| Handler contract  | `BaseHandler` with `validate()` + `execute()`                              |
| Registration      | `HandlerRegistry` maps DSL `type` → handler instance                       |
| Nested DSL        | `spend_shinsu` wraps an inner `effect`; `grant_ability` wraps an `ability` |
| Cascading effects | `context.emitChild()` triggers downstream events                           |

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

---

## DSL-to-Handler Mapping

The compiled `cards.json` contains effect objects like:

```json
{
  "type": "deal_damage",
  "amount": 7,
  "target": "enemy",
  "raw": "deal 7 to an enemy",
  "handler": null
}
```

At runtime, the resolution engine:

1. Reads `effect.type` → `"deal_damage"`
2. Resolves any target descriptor through `TargetResolver`
3. Looks up `registry.get("deal_damage")` → `DealDamageHandler`
4. Calls `handler.validate(payload)` with concrete `targetId` values
5. Calls `handler.execute(payload, context, gameState)`

For `type: "custom"` effects, there is **no handler registered**. These are unresolved raw-text effects that the resolution engine skips gracefully and reports through the unsupported-effect event. They are not parsed at runtime.

---

## Baseline Handlers

| Handler                    | DSL `type`           | Key behavior                                                                            |
| -------------------------- | -------------------- | --------------------------------------------------------------------------------------- |
| `DealDamageHandler`        | `deal_damage`        | Barrier → Resilient → Weak → `UnitService.damage` → kill check → emitChildren           |
| `HealHandler`              | `heal`               | Applies healing via `UnitService.heal`, capped at max HP                                |
| `GrantTraitHandler`        | `grant_trait`        | `stack.apply({ type:"trait", key, value })`                                             |
| `GiveConditionHandler`     | `give_condition`     | Respects Immune; `stack.apply({ type:"condition", ... })`                               |
| `CleanseHandler`           | `cleanse`            | `stack.removeWhere(m => m.type === "condition")`                                        |
| `CreateLighthouseHandler`  | `create_lighthouse`  | Delegates to `GameState.modifyLighthouses` (cap 40)                                     |
| `DestroyLighthouseHandler` | `destroy_lighthouse` | Delegates to `GameState.modifyLighthouses` (floor 0); emits `game:lighthouses:depleted` |
| `SpendShinsuHandler`       | `spend_shinsu`       | Delegates to `ShinsuService.spend`; recharged first, then normal                        |
| `DrawCardHandler`          | `draw_card`          | Delegates to `ZoneService.draw`; emits `game:deck:empty` on exhaustion                  |

---

## Additional Handlers

| Handler                 | DSL `type`        | Key behavior                                                                                           |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------------ |
| `ChargeShinsuHandler`   | `charge_shinsu`   | Delegates to `ShinsuService.gain`; capped at round max; emits `shinsu:charged`                         |
| `CompressShinsuHandler` | `compress_shinsu` | Delegates to `CompressionService.compress`; receives `targetCardId` from EffectResolver/TargetResolver |
| `ReclaimCardsHandler`   | `reclaim_cards`   | Delegates to `ZoneService.reclaimTop`; emits `card:reclaimed`                                          |
| `GrantAbilityHandler`   | `grant_ability`   | Registers inner ability via `AbilityRegistry`; revoked on source removal                               |

All structured DSL types listed above have handler implementations. `custom` effects remain unresolved; the runtime skips them safely and reports an unsupported-effect event rather than parsing raw text.

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

1. Reads `effect.type`, looks up handler via `HandlerRegistry`
2. Handles nested effects: `spend_shinsu.effect` resolved recursively after deduction
3. `grant_ability.ability` is stored by the GrantAbilityHandler, not resolved immediately
4. `type: "custom"` is skipped with a warning

---

## Nested DSL Resolution

Some compiled DSL types are **nested** — they contain inner effect objects that themselves need handler resolution.

### `spend_shinsu` (7 occurrences)

```json
{
  "type": "spend_shinsu",
  "amount": 1,
  "effect": {
    "type": "custom",
    "raw": "give Rooted to 2 enemies",
    "handler": null
  }
}
```

Resolution flow:

1. `SpendShinsuHandler` validates and deducts shinsu
2. If successful, it resolves the inner `effect` by looking up its `type` in the registry
3. The inner effect may itself be nested (e.g., `spend_shinsu` wrapping `deal_damage`)

**⚠️ This requires a recursive resolution function**:

```js
function resolveEffect(effect, context, gameState, extra = {}) {
  if (effect.type === "custom") {
    // Skip unresolved raw text and emit an unsupported-effect event.
    return { skipped: true };
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

**⚠️ The `handler` field is always `null` in compiled data.** It was a design artifact for custom handler names. It may be repurposed for named custom handler lookup later.

---

## Anti-patterns

- **Don't parse `raw` text for logic** — use structured fields.
- **Don't skip validation** — always call `handler.validate()` before `execute()`.
- **Don't hold state in handler instances** — they're singletons.
- **Don't swallow custom effects silently** — log a warning so they get handlers eventually.
