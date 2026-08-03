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

| Concept | Implementation |
|---|---|
| Handler contract | `BaseHandler` with `validate()` + `execute()` |
| Registration | `HandlerRegistry` maps DSL `type` → handler instance |
| Nested DSL | `spend_shinsu` wraps an inner `effect`; `grant_ability` wraps an `ability` |
| Cascading effects | `context.emitChild()` triggers downstream events |

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

registry.has("deal_damage");            // → true
registry.get("deal_damage");            // → DealDamageHandler instance
registry.get("deal_damage").execute(payload, ctx, gameState);
```

**⚠️ `register()` instantiates the handler class.** All handlers are
singletons — they hold no per-invocation state. If a handler needs
per-effect state, pass it in the payload.

**⚠️ The registry key is the DSL `type` field** from the compiled
`cards.json`. This is the bridge between Phase 0 (compiler) and Phase 2+
(runtime).

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

For `type: "custom"` effects (~130 in the card set), there is **no handler
registered**. These are raw-text effects deferred to Phase 4. The resolution
engine must skip them gracefully (log a warning, don't crash).

---

## Baseline Handlers (Phase 1)

| Handler | DSL `type` | Key behavior |
|---|---|---|
| `DealDamageHandler` | `deal_damage` | Barrier → Resilient → Weak → apply → kill check → emitChildren |
| `HealHandler` | `heal` | Applies healing, capped at max HP |
| `GrantTraitHandler` | `grant_trait` | `stack.apply({ type:"trait", key, value })` |
| `GiveConditionHandler` | `give_condition` | Respects Immune; `stack.apply({ type:"condition", ... })` |
| `CleanseHandler` | `cleanse` | `stack.removeWhere(m => m.type === "condition")` |
| `CreateLighthouseHandler` | `create_lighthouse` | Modifies `playerState.lighthouses.amount` (cap 40) |
| `DestroyLighthouseHandler` | `destroy_lighthouse` | Modifies `playerState.lighthouses.amount` (floor 0); emits `game:lighthouses:depleted` on 0 |
| `SpendShinsuHandler` | `spend_shinsu` | Deducts recharged first, then normal |
| `DrawCardHandler` | `draw_card` | Pops from deck; emits `game:deck:empty` on exhaustion |

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

**⚠️ This requires a recursive resolution function** in Phase 2:
```js
function resolveEffect(effect, context, gameState) {
  if (effect.type === "custom") {
    // Skip — deferred to Phase 4
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

### `grant_ability` (2 occurrences)

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
`target` etc. It must be treated as a fully-resolvable ability — the
`GrantAbilityHandler` should register it as an event handler on
`unit:ability:use` for the bearer, not execute it immediately.

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
Phase 0 design artifact for custom handler names. It may be repurposed
in Phase 4 for named custom handler lookup.

---

## Missing Handlers (Phase 2+)

These DSL types appear in `cards.json` but have no handler:

| DSL type | Occurrences | Example card |
|---|---|---|
| `reclaim_cards` | 1 | The Workshop |
| `grant_ability` | 2 | Red Thryssa, Purple Dementor |
| `compress_shinsu` | ~3 | Yu Han Sung, Fiery Elephant |
| `charge_shinsu` | ~2 | Various |
| `custom` | ~130 | Almost every card |

Phase 2 should implement `reclaim_cards` and `grant_ability` (they appear in production cards). The remaining types
and all `custom` effects are Phase 4's responsibility.

---

## Integration with Phase 2+

### What Phase 2 must do

1. **Wire the HandlerRegistry into GameState** — instantiate it, register
   all 9 baseline handlers, and provide a `resolveEffect(effect, ctx)` method.

2. **Implement recursive DSL resolution** for nested types (`spend_shinsu`,
   `grant_ability`).

3. **Implement missing handlers** for `reclaim_cards`
   and `grant_ability`.

4. **Wire ability execution** — `UseAbilityAction` currently does nothing.
   It should look up the unit's ability DSL, resolve it through the
   registry, and spend the combat slot.

5. **Wire passive registration** — when a unit is deployed, its passives
   should subscribe to the appropriate events (round start, round end,
   on damage, etc.) using the EventBus and trigger handler execution.

### Anti-patterns

- **Don't parse `raw` text for logic** — use structured fields.
- **Don't skip validation** — always call `handler.validate()` before `execute()`.
- **Don't hold state in handler instances** — they're singletons.
- **Don't swallow custom effects silently** — log a warning so Phase 4
  knows which effects need handlers.
