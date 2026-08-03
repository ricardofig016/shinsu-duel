# Compiled Card DSL — Shinsu Duel

This document describes the contract between the Phase 0 card compiler
(`scripts/card-compile.js`) and the Phase 2+ runtime engine. It specifies
what the runtime can expect from `server/data/cards.json` and how to
interpret each DSL type.

---

## Overview

The card compiler reads YAML source files from `data/cards/`, validates
them, and produces a single `server/data/cards.json` file. This file is
the **sole runtime data source** — the game engine never reads YAML directly.

| Source | Compiled | Validated by |
|---|---|---|
| `data/cards/*.yml` | `server/data/cards.json` | `scripts/card-validate.js` (YAML) + `schemas/compiled-cards.schema.json` (JSON) |

Commands:
```powershell
npm run validate:cards   # validate YAML only
npm run compile:cards    # validate YAML → compile → validate JSON → write
```

**⚠️ Never edit `server/data/cards.json` by hand.** Always edit the YAML
source and recompile. The compiled file is a build artifact.

---

## Top-Level Structure

```json
{
  "0": { /* card object */ },
  "1": { /* card object */ },
  "...": {},
  "65": { /* card object */ }
}
```

Keys are string representations of card IDs (`"0"` through `"65"` for 66
cards). IDs are assigned alphabetically by card name at compile time.

**⚠️ Card IDs are stable within a compile run but may shift when cards
are added or renamed.** Do not hardcode card IDs in game logic — look
up by name or use the compiled `cardId` field.

---

## Card Object Shapes

### Unit

```json
{
  "cardId": 27,
  "type": "unit",
  "name": "Jyu Viole Grace",
  "cost": 4,
  "hp": 4,
  "rank": "regular",
  "positions": ["wave-controller"],
  "traits": [],
  "attributes": ["irregular"],
  "affiliations": ["team-baam", "fug"],
  "abilities": [ /* DSL objects */ ],
  "passives": [ /* DSL objects */ ],
  "evolveInto": { /* optional transformation */ },
  "evolvedFrom": 26,       /* optional — cardId of base form */
  "deckConstraints": []
}
```

### Skill

```json
{
  "cardId": 12,
  "type": "skill",
  "name": "Fiery Elephant",
  "cost": 2,
  "effects": [ /* DSL objects — at least 1 */ ],
  "requirements": ["target is an ally"],  /* optional */
  "deckConstraints": []
}
```

### Equipment

```json
{
  "cardId": 30,
  "type": "equipment",
  "name": "Karaka's Armor Suit",
  "cost": 4,
  "effects": [ /* DSL objects — at least 1 */ ],
  "requirements": ["deployed as Fisherman"],  /* optional */
  "igniteInto": { /* optional transformation */ },
  "ignitedFrom": 29,       /* optional — cardId of base form */
  "deckConstraints": []
}
```

---

## DSL Object Shape

Every ability, passive, and effect is a **DSL object** with this base shape:

```json
{
  "type": "deal_damage",
  "raw": "deal 7 to an enemy",
  "handler": null
}
```

| Field | Required | Description |
|---|---|---|
| `type` | Yes | One of the DSL types below. `"custom"` means unresolved. |
| `raw` | Yes | Original card text. Authoritative. Never parsed at runtime. |
| `handler` | Always `null` | Phase 0 artifact. May be repurposed in Phase 4. |

Additional fields depend on `type` (see below).

### Common additional fields

| Field | Types that use it | Description |
|---|---|---|
| `amount` | `deal_damage`, `heal`, `spend_shinsu`, `give_condition`, `grant_trait`, `create_lighthouse`, `destroy_lighthouse`, `reclaim_cards`, `compress_shinsu`, `charge_shinsu` | Numeric value |
| `target` | `deal_damage`, `heal`, `cleanse`, `give_condition`, `grant_trait`, `grant_ability` | `"enemy"`, `"ally"`, `"self"`, `"bearer"`, `"all_enemies"`, `"all_allies"` |
| `condition` | `give_condition` | `"burned"`, `"poisoned"`, `"rooted"`, etc. |
| `trait` | `grant_trait` | `"barrier"`, `"strong"`, `"lethal"`, etc. |
| `quick` | abilities, effects | `true` if the ability/effect has Quick keyword |
| `position` | abilities, passives | Position code if position-scoped, else `null` |
| `effect` | `spend_shinsu` | Nested DSL object — the effect that costs shinsu |
| `ability` | `grant_ability` | Nested DSL object — the granted ability |
| `count` | `deal_damage`, `give_condition` | Number of targets (e.g., "2 enemies") |
| `conditionValue` | `deal_damage` | Conditional targeting (e.g., "deal 3 to all Rooted enemies") |

---

## DSL Type Reference

### Structured types (have handlers)

| `type` | Handler | Example `raw` |
|---|---|---|
| `deal_damage` | `DealDamageHandler` | `"deal 7 to an enemy"` |
| `heal` | `HealHandler` | `"heal me 3 HP"` |
| `cleanse` | `CleanseHandler` | `"Cleanse an ally"` |
| `give_condition` | `GiveConditionHandler` | `"give Burned 1 to all enemies"` |
| `grant_trait` | `GrantTraitHandler` | `"the bearer has Bloodthirsty 1"` |
| `spend_shinsu` | `SpendShinsuHandler` | `"spend 1: give Rooted to 2 enemies"` |
| `create_lighthouse` | `CreateLighthouseHandler` | `"create 1"` |
| `destroy_lighthouse` | `DestroyLighthouseHandler` | `"destroy 1"` |

### Structured types (need handlers in Phase 2)

| `type` | Occurrences | Example `raw` |
|---|---|---|
| `reclaim_cards` | 1 | `"reclaim 1"` (The Workshop) |
| `grant_ability` | 2 | `"ability: give Poisoned 4 to an enemy"` (Purple Dementor) |
| `compress_shinsu` | ~3 | `"Compress 1"` (Yu Han Sung) |
| `charge_shinsu` | ~2 | `"Charge 2"` |

### Unresolved type

| `type` | Occurrences | Description |
|---|---|---|
| `custom` | ~130 | Raw text, `handler: null`. Phase 4 responsibility. |

---

## Nested DSL Patterns

### `spend_shinsu` wrapping an effect

```json
{
  "type": "spend_shinsu",
  "amount": 2,
  "effect": {
    "type": "custom",
    "raw": "use an enemy ability",
    "handler": null
  },
  "raw": "spend 2: use an enemy ability"
}
```

Resolution: validate shinsu → deduct → resolve `effect` through registry.

### `grant_ability` wrapping an ability

```json
{
  "type": "grant_ability",
  "target": "bearer",
  "ability": {
    "type": "deal_damage",
    "amount": 5,
    "target": "enemy",
    "raw": "deal 5 to an enemy",
    "handler": null
  },
  "raw": "ability: deal 5 to an enemy"
}
```

Resolution: register the inner `ability` as a usable ability on the bearer
(don't execute it immediately).

### `deal_damage` with conditional targeting

```json
{
  "type": "deal_damage",
  "amount": 3,
  "target": "all_enemies",
  "condition": "rooted",
  "raw": "deal 3 to all Rooted enemies"
}
```

Resolution: find all enemies, filter by `condition`, deal damage to each.

---

## Transformation Objects

### Evolution

```json
"evolveInto": {
  "trigger": {
    "type": "custom",
    "raw": "i am equipped with Ice Spear",
    "handler": null
  },
  "cardId": 32
},
"evolvedFrom": 31
```

### Ignition

```json
"igniteInto": {
  "trigger": {
    "type": "custom",
    "raw": "the bearer Slays a unit",
    "handler": null
  },
  "cardId": 38
},
"ignitedFrom": 37
```

**⚠️ Triggers are `type: "custom"` with raw text.** Phase 4 will need to
parse these or register named trigger handlers. Phase 2 should wire the
event subscriptions (e.g., `unit:slay` → check ignition trigger) but can
defer the actual trigger parsing.

---

## Deck Constraints

```json
"deckConstraints": [
  { "type": "unreachable" }
]
```

- `"unreachable"` — card cannot be drawn normally. Must be created by
  an effect (Thorn Fragments, Enryu's Thorn, Shinwonryu).

Phase 2 must enforce this in draw logic.

---

## Integration with Phase 2+

### What Phase 2 must do

1. **Load `cards.json` at startup** — already done by `GameState.cards`.

2. **Map DSL `type` to HandlerRegistry key** — the registry key IS the
   `type` field. No translation needed.

3. **Handle nested DSL** — `spend_shinsu.effect` and `grant_ability.ability`
   need recursive resolution.

4. **Skip `type: "custom"` gracefully** — log a warning, don't crash.

5. **Enforce `deckConstraints`** — `unreachable` cards can't be in
   starting decks or drawn normally.

6. **Parse `requirements`** on skills/equipment — currently stored as
   raw strings like `"deployed as Fisherman"` or `"target is an ally"`.
   Phase 2 needs to resolve these at play time.

### Anti-patterns

- **Don't parse `raw`** — it's for display/debugging only.
- **Don't hardcode card IDs** — they shift when cards change.
- **Don't assume `handler` will be non-null** — it's always null.
- **Don't mutate the compiled data** — treat it as read-only.
