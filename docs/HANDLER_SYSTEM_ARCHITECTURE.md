# Handler System Architecture — Shinsu Duel

This document describes the handler pattern, registry, and DSL-to-handler
mapping that resolves card effects into state mutations.

---

## Overview

All card effects — abilities, passives, equipment effects, skill effects,
evolution triggers, and ignition triggers — are resolved by **handler
classes** that extend `BaseHandler`. Handlers receive a structured payload,
validate it, and execute state changes through the `ModifierStack` and
`EventBus`.

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

**⚠️ The validate/execute split is critical.** Validation failures must
throw before any state mutation occurs. A handler that mutates state during
validation, then throws, leaves the game in a corrupt state.

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

**⚠️ `register()` instantiates the handler class.** All handlers are
singletons — they hold no per-invocation state. If a handler needs
per-effect state, pass it in the payload.

**⚠️ The registry key is the DSL `type` field** from the compiled
`cards.json`. This is the bridge between the compiler and the runtime
engine.

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
2. Looks up `registry.get("deal_damage")` → `DealDamageHandler`
3. Calls `handler.validate(payload)`
4. Calls `handler.execute(payload, context, gameState)`

For `type: "custom"` effects (~130 in the card set), there is **no handler registered**. These are raw-text effects that the resolution engine must skip gracefully (log a warning, don't crash).

---

## Baseline Handlers

| Handler                    | DSL `type`           | Key behavior                                                                                |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| `DealDamageHandler`        | `deal_damage`        | Barrier → Resilient → Weak → apply → kill check → emitChildren                              |
| `HealHandler`              | `heal`               | Applies healing, capped at max HP                                                           |
| `GrantTraitHandler`        | `grant_trait`        | `stack.apply({ type:"trait", key, value })`                                                 |
| `GiveConditionHandler`     | `give_condition`     | Respects Immune; `stack.apply({ type:"condition", ... })`                                   |
| `CleanseHandler`           | `cleanse`            | `stack.removeWhere(m => m.type === "condition")`                                            |
| `CreateLighthouseHandler`  | `create_lighthouse`  | Modifies `playerState.lighthouses.amount` (cap 40)                                          |
| `DestroyLighthouseHandler` | `destroy_lighthouse` | Modifies `playerState.lighthouses.amount` (floor 0); emits `game:lighthouses:depleted` on 0 |
| `SpendShinsuHandler`       | `spend_shinsu`       | Deducts recharged first, then normal                                                        |
| `DrawCardHandler`          | `draw_card`          | Pops from deck; emits `game:deck:empty` on exhaustion                                       |

---

## Additional Handlers

| Handler                 | DSL `type`        | Key behavior                                                                |
| ----------------------- | ----------------- | --------------------------------------------------------------------------- |
| `ChargeShinsuHandler`   | `charge_shinsu`   | Adds shinsu to normal pool, capped at round max; emits `shinsu:charged`     |
| `CompressShinsuHandler` | `compress_shinsu` | Reduces the selected card instance's cost via `costReduction`               |
| `ReclaimCardsHandler`   | `reclaim_cards`   | Moves `amount` cards from discard to hand; emits `card:reclaimed`           |
| `GrantAbilityHandler`   | `grant_ability`   | Registers inner ability DSL via ModifierStack; cleaned up on source removal |

All 12 structured DSL types have handler implementations. `custom` type effects (~130) remain unresolved until custom handlers are written.

## EffectResolver

The `EffectResolver` is the recursive resolution engine that maps DSL objects
to handlers:

```js
resolveEffect(effect, context, gameState, extra);
```

1. Reads `effect.type`, looks up handler via `HandlerRegistry`
2. Handles nested effects: `spend_shinsu.effect` resolved recursively after deduction
3. `grant_ability.ability` is stored by the GrantAbilityHandler, not resolved immediately
4. `type: "custom"` is skipped with a warning

---

## Nested DSL Resolution

Some compiled DSL types are **nested** — they contain inner effect objects
that themselves need handler resolution.

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
2. If successful, it resolves the inner `effect` by looking up its `type`
   in the registry
3. The inner effect may itself be nested (e.g., `spend_shinsu` wrapping
   `deal_damage`)

**⚠️ This requires a recursive resolution function**:

```js
function resolveEffect(effect, context, gameState) {
  if (effect.type === "custom") {
    // Skip — custom types are handled elsewhere
    return;
  }
  const handler = registry.get(effect.type);
  handler.execute(effect, context, gameState);

  // If the effect wraps an inner effect, recurse
  if (effect.effect) {
    resolveEffect(effect.effect, context, gameState);
  }
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

The inner `ability` is a full DSL object with its own `type`, `amount`,
`target` etc. `GrantAbilityHandler` registers it on the bearer via
`ModifierStack` (`type: "ability"`) instead of executing it immediately.

The bearer's player can then use it through `UseAbilityAction`, addressed
as `granted:<modifierId>` instead of a numeric ability index. Unequipping
the source removes the modifier, which makes the ability unusable again —
no separate cleanup path is needed.

---

## Handler Payload Conventions

Every handler receives the DSL object as its payload (plus `context` and
`gameState`). The payload contains all fields from the compiled effect:

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

**⚠️ The `raw` field is always present** — it's the original card text.
Handlers can use it for logging/error messages but should NOT parse it
for logic. Use the structured fields only.

**⚠️ The `handler` field is always `null` in compiled data.** It was a
design artifact for custom handler names. It may be repurposed for named
custom handler lookup later.

---

## Anti-patterns

- **Don't parse `raw` text for logic** — use structured fields.
- **Don't skip validation** — always call `handler.validate()` before `execute()`.
- **Don't hold state in handler instances** — they're singletons.
- **Don't swallow custom effects silently** — log a warning so they get
  handlers eventually.
