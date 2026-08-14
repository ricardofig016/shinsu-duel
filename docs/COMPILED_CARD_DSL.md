# Compiled Card DSL — Shinsu Duel

This document describes the contract between the card compiler (`scripts/card-compile.js`) and the runtime engine. It specifies what the runtime can expect from `server/data/cards.json` and how to interpret each DSL type.

---

## Overview

The card compiler reads YAML source files from `data/cards/`, validates them, and produces a single `server/data/cards.json` file. This file is the **sole runtime data source** — the game engine never reads YAML directly.

| Source                | Compiled                 | Validated by                                                                    |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------- |
| `data/cards/**/*.yml` | `server/data/cards.json` | `scripts/card-validate.js` (YAML) + `schemas/compiled-cards.schema.json` (JSON) |

Card source files may be organized under `data/cards/` subdirectories. The compiler and validator discover YAML files recursively; directory names do not affect card identity or compiled IDs.

Commands:

```powershell
npm run validate:cards   # validate YAML only
npm run compile:cards    # validate YAML → compile → validate JSON → write
```

**⚠️ Never edit `server/data/cards.json` by hand.** Always edit the YAML source and recompile. The compiled file is a build artifact.

---

## Top-Level Structure

```json
{
  "0": {
    /* card object */
  },
  "1": {
    /* card object */
  },
  "...": {},
  "50": {
    /* card object */
  }
}
```

Keys are string representations of card IDs. IDs are assigned alphabetically by card name at compile time.

**⚠️ Card IDs are stable within a compile run but may shift when cards are added or renamed.** Do not hardcode card IDs in game logic — look up by name or use the compiled `cardId` field.

### Special case: Conduit

**Conduit** is a Jeonsulsa-mechanic unit with no positions or rank in its source YAML. The validator and compiler normalize it to a dummy `positions: ["landmark"]` so schema validation passes; its actual placement is governed by the Jeonsulsa mechanics at runtime, not by a position field.

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
  "abilities": [
    /* DSL objects */
  ],
  "passives": [
    /* DSL objects */
  ],
  "evolveInto": {
    /* optional transformation */
  },
  "evolvedFrom": 26 /* optional — cardId of base form */,
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
  "effects": [
    /* DSL objects — at least 1 */
  ],
  "requirements": ["target is an ally"] /* optional */,
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
  "effects": [
    /* DSL objects — at least 1 */
  ],
  "requirements": ["deployed as Fisherman"] /* optional */,
  "igniteInto": {
    /* optional transformation */
  },
  "ignitedFrom": 29 /* optional — cardId of base form */,
  "deckConstraints": []
}
```

---

## Requirements

`requirements` is an optional array of raw strings gating card play or use. They are validated by `RequirementValidator` before any cost is paid. Supported patterns (all enforced; unknown patterns fail validation):

| Pattern                                  | Example                                              |
| ---------------------------------------- | ---------------------------------------------------- |
| `deployed as <position>`                 | `"deployed as Fisherman"`                            |
| `target is an ally` / `enemy`            | `"target is an ally"`                                |
| `target is a <rank>`                     | `"target is a Ranker"`                               |
| `<name> is in your board`                | `"Yeon Woon is in your board"`                       |
| `I'm the first card you play this round` | —                                                    |
| `<affiliation> member`                   | `"khun family member"`                               |
| `you have an ally <A> or <B>`            | `"you have an ally yeon family member or Hwayeomsa"` |
| `have an ally <attribute>`               | `"have an ally Irregular"`                           |

Patterns that reference the board (`member`, `is in your board`, `ally`) check the current player's field; affiliation and attribute matches include runtime-granted modifiers from the `ModifierStack`.

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

| Field     | Required      | Description                                                 |
| --------- | ------------- | ----------------------------------------------------------- |
| `type`    | Yes           | One of the DSL types below. `"custom"` means unresolved.    |
| `raw`     | Yes           | Original card text. Authoritative. Never parsed at runtime. |
| `handler` | Always `null` | Design artifact. May be repurposed later.                   |

Additional fields depend on `type` (see below).

### Common additional fields

| Field                | Types that use it                                                                                                                                                      | Description                                                                |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `amount`             | `deal_damage`, `heal`, `spend_shinsu`, `give_condition`, `grant_trait`, `create_lighthouse`, `destroy_lighthouse`, `reclaim_cards`, `compress_shinsu`, `charge_shinsu` | Numeric value                                                              |
| `target`             | `deal_damage`, `heal`, `cleanse`, `give_condition`, `grant_trait`, `grant_ability`                                                                                     | `"enemy"`, `"ally"`, `"self"`, `"bearer"`, `"all_enemies"`, `"all_allies"` |
| `targetCardSelector` | `compress_shinsu`                                                                                                                                                      | Selector after `from`, resolved against the owner's hand                   |
| `condition`          | `give_condition`                                                                                                                                                       | Condition to apply, such as `"burned"`, `"poisoned"`, or `"rooted"`.       |
| `trigger`            | passives only                                                                                                                                                          | `"round start"` or `"round end"` — see `PASSIVE_SYSTEM_ARCHITECTURE.md`    |
| `trait`              | `grant_trait`                                                                                                                                                          | `"barrier"`, `"strong"`, `"lethal"`, etc.                                  |
| `quick`              | abilities, effects                                                                                                                                                     | `true` if the ability/effect has Quick keyword                             |
| `position`           | abilities, passives                                                                                                                                                    | Position code if position-scoped, else `null`                              |
| `effect`             | `spend_shinsu`                                                                                                                                                         | Nested DSL object — the effect that costs shinsu                           |
| `ability`            | `grant_ability`                                                                                                                                                        | Nested DSL object — the granted ability                                    |
| `count`              | `deal_damage`, `give_condition`                                                                                                                                        | Number of targets (e.g., "2 enemies")                                      |
| `conditionValue`     | `deal_damage`                                                                                                                                                          | Conditional targeting (e.g., "deal 3 to all Rooted enemies")               |

---

## DSL Type Reference

### Structured types (have handlers)

| `type`               | Handler                    | Example `raw`                                |
| -------------------- | -------------------------- | -------------------------------------------- |
| `deal_damage`        | `DealDamageHandler`        | `"deal 7 to an enemy"`                       |
| `heal`               | `HealHandler`              | `"heal me 3 HP"`                             |
| `cleanse`            | `CleanseHandler`           | `"Cleanse an ally"`                          |
| `give_condition`     | `GiveConditionHandler`     | `"give Burned 1 to all enemies"`             |
| `grant_trait`        | `GrantTraitHandler`        | `"the bearer has Bloodthirsty 1"`            |
| `spend_shinsu`       | `SpendShinsuHandler`       | `"spend 1: give Rooted to 2 enemies"`        |
| `create_lighthouse`  | `CreateLighthouseHandler`  | `"create 1"`                                 |
| `destroy_lighthouse` | `DestroyLighthouseHandler` | `"destroy 1"`                                |
| `charge_shinsu`      | `ChargeShinsuHandler`      | `"Charge 2"`                                 |
| `compress_shinsu`    | `CompressShinsuHandler`    | `"Compress 1 from a Hwayeomsa in your hand"` |
| `reclaim_cards`      | `ReclaimCardsHandler`      | `"reclaim 1"`                                |
| `grant_ability`      | `GrantAbilityHandler`      | `"ability: give Poisoned 4 to an enemy"`     |

All structured DSL types listed above have runtime handlers. `custom` effects remain unresolved and are skipped safely by the runtime.

### Unresolved type

| `type`   | Description                                                                       |
| -------- | --------------------------------------------------------------------------------- |
| `custom` | Raw text with `handler: null`; reported as unsupported and not parsed at runtime. |

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

Resolution: register the inner `ability` as a usable ability on the bearer (don't execute it immediately).

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

Transformation targets use the canonical names `<base name> - Evolved` and `<base name> - Ignited`. The compiler resolves these names at compile time; transformation targets must exist and have the expected card type.

### Evolution

```json
"evolveInto": {
  "triggers": [
    { "type": "equip", "cardName": "Ice Spear", "raw": "i am equipped with Ice Spear" }
  ],
  "cardId": 32
}
```

### Ignition

```json
"igniteInto": {
  "triggers": [
    { "type": "slay", "target": "unit", "raw": "the bearer Slays a unit" }
  ],
  "cardId": 38
}
```

### Position-scoped equip trigger

```json
"evolveInto": {
  "triggers": [
    { "type": "equip", "cardName": "Karaka's Armor Suit", "position": "fisherman", "raw": "Fisherman: equip with Karaka's Armor Suit" }
  ],
  "cardId": 34
}
```

Supported trigger types: `equip`, `slay`, `deploy`, `given`, `kill`, `ally_dies`, `damaged_by`, `round_start`, `round_end`, `deal_damage`, `ability_used`. Unsupported triggers fail compilation until modeled in `parseTrigger()`.

---

## Fire Core / Incinerate Cards

Hwayeomsa attribute cards, all `unreachable`:

| Card           | Cost | Effect                                                 |
| -------------- | ---- | ------------------------------------------------------ |
| Fire Core      | 0    | Quick — consume Fire Charges to create Incinerate      |
| Incinerate I   | 0    | 1 charge → deal 1 to an enemy                          |
| Incinerate II  | 0    | 3 charges → deal 2 to 2 enemies                        |
| Incinerate III | 0    | 5 charges → deal 2 to 3 enemies and give them Burn     |
| Incinerate IV  | 0    | 7 charges → deal 3 to all enemies and give them Burn 2 |

---

## Deck Constraints

```json
"deckConstraints": [
  { "type": "unreachable" }
]
```

- `"unreachable"` — card cannot be included in a constructed deck. It may still be created during play and is drawn normally if a runtime effect places it in a deck; `ZoneService.draw` enforces exhaustion, not deck legality.

---

## Anti-patterns

- **Don't parse `raw`** — it's for display/debugging only.
- **Don't hardcode card IDs** — they shift when cards change.
- **Don't assume `handler` will be non-null** — it's always null.
- **Don't mutate the compiled data** — treat it as read-only.
