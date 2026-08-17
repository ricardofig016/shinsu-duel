# Card Effect DSL — Shinsu Duel

This document is the authoritative contract for **card effect authoring and the compiled DSL**. It defines the structured grammar that card authors write in YAML and the normalized form the runtime engine consumes from `server/data/cards.json`.

---

## Overview

Cards are authored as YAML in `data/cards/` and compiled to a single `server/data/cards.json`. That file is the **sole runtime data source** — the game engine never reads YAML directly.

| Source                | Compiled                 | Validated by                                                                                                 |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `data/cards/**/*.yml` | `server/data/cards.json` | `scripts/card-validate.js` + `schemas/card.schema.json` (YAML) → `schemas/compiled-cards.schema.json` (JSON) |

Commands:

```powershell
npm run validate:cards   # validate YAML only
npm run compile:cards    # validate YAML → compile → validate JSON → write
```

**⚠️ Never edit `server/data/cards.json` by hand.** Always edit the YAML source and recompile. The compiled file is a build artifact.

---

## Authoring model

Effects, abilities, and passives are **structured DSL nodes**, not natural-language strings. The compiler validates and normalizes them; it never guesses meaning from prose. Card text is authored separately as a display-only `raw` field.

```yaml
effects:
  - type: deal_damage
    amount: 3
    target: { side: enemy }
    raw: "deal 3 to an enemy"
```

Guarantees:

- `raw` is display text. It is **never parsed** at compile or run time.
- The compiler **fails loudly** on any node `type` it does not recognize. There is no `custom` fallback and no `handler` field — the handler registry maps `type` to a handler class, one per type.
- `type` is the single bridge between a compiled node and its runtime handler.

---

## Node shape

Every node is an object with a discriminator `type` and a field set that depends on that type.

| Field      | Scope                        | Description                                    |
| ---------- | ---------------------------- | ---------------------------------------------- |
| `type`     | every node                   | One of the node types in the catalog below.    |
| `raw`      | top-level entries (required) | Authored display text. Never parsed.           |
| `quick`    | abilities, effects           | `true` if the entry has the Quick keyword.     |
| `free`     | abilities, effects           | `true` if the entry has the Free keyword.      |
| `position` | abilities, passives          | Position code if position-scoped, else `null`. |
| `trigger`  | passives                     | The event that activates a triggered passive.  |

Top-level entries (`abilities`, skill/equipment `effects`, and `passives`) require `raw`. Nested nodes (`sequence.steps[]`, `spend_shinsu.effect`, `grant_ability.ability`, `conditional.then/otherwise`) omit `raw`.

### Card metadata

Two card-level fields sit alongside node entries:

- `keywords` — identity markers, independent of `type`/`attributes`. Each item is either a bare string or an object carrying the player-visible identity text:

  ```yaml
  keywords:
    - jeonsul-baang # machine identity only
    - code: jeonsul-baang # identity + visible text
      raw: "i am a Jeonsul Baang"
  ```

  The compiled form is a uniform object — `{ code }` or `{ code, raw }` — mirroring compiled traits (`{ code, value? }`). The Jeonsulsa engine and future identity mechanics query by `code`; the UI renders `raw`. Use the object form whenever the player should see the keyword's text on the card.

- `deckConstraints` — deck-construction rules authored in YAML (see [Deck constraints](#deck-constraints)). Each constraint carries required `raw` display text.

Card-level keywords (Quick, Free) that apply to the whole card — not to a single effect — are authored as marker nodes: `{ type: quick, raw: "i am Quick" }`. See [Structural](#structural).

---

## Node catalog

### Resource

| `type`               | Fields             | Meaning                                       |
| -------------------- | ------------------ | --------------------------------------------- |
| `charge_shinsu`      | `amount`           | Regain `amount` normal shinsu.                |
| `spend_shinsu`       | `amount`, `effect` | Spend `amount` shinsu, then resolve `effect`. |
| `compress_shinsu`    | `amount`, `card`   | Reduce a card's cost by `amount`.             |
| `reclaim_cards`      | `amount`, `card?`  | Put `amount` cards from discard into hand.    |
| `create_lighthouse`  | `amount`           | Regain `amount` lighthouses.                  |
| `destroy_lighthouse` | `amount`, `owner?` | Destroy `amount` lighthouses.                 |

### Cards and zones

| `type`            | Fields                            | Meaning                                                                                                    |
| ----------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `draw_card`       | `amount`, `card?`                 | Draw `amount` cards (optionally filtered by `card`).                                                       |
| `create_card`     | `card`                            | Create a card in hand. Exact `card.name` (optionally `card.type`) creates that card.                       |
| `summon`          | `card`, `from`, `onto`, `random?` | Put a unit onto a battlefield (`from`: `deck`, `hand`, `deck_or_hand`, or `game` = all existing cards).    |
| `discard`         | `card`, `owner`                   | Send a card from an owner's hand to their discard.                                                         |
| `steal`           | `card`                            | Take a card from the opponent into your control.                                                           |
| `disarm`          | `target`, `to`                    | Send a unit's equipment to `hand` (the equipment owner's hand) or `discard` (the acting player's discard). |
| `switch_position` | `target`                          | Force a unit to switch positions.                                                                          |

### Units

| `type`               | Fields                           | Meaning                                            |
| -------------------- | -------------------------------- | -------------------------------------------------- |
| `deal_damage`        | `amount`, `target`               | Deal `amount` damage.                              |
| `heal`               | `amount`, `target`               | Heal `amount` HP.                                  |
| `give_condition`     | `condition`, `amount?`, `target` | Apply a condition (optionally stacked).            |
| `cleanse`            | `target`                         | Remove all conditions.                             |
| `grant_trait`        | `trait`, `amount?`, `target`     | Grant a trait (optionally numeric).                |
| `remove_traits`      | `target`, `trait?`               | Remove all traits, or one named `trait` (Silence). |
| `copy_traits`        | `target`, `source`               | Copy traits from `source` onto `target`.           |
| `grant_random_trait` | `target`, `numeric?`             | Grant a random trait.                              |
| `slay`               | `target`                         | Kill units directly (ignores damage).              |
| `transform`          | `cardName`                       | Replace the unit with another card (revert).       |
| `grant_ability`      | `ability`, `target`              | Grant an ability (register, don't execute).        |
| `copy_ability`       | `source`                         | Use a copy of an enemy `source`'s ability.         |
| `peek_hand`          | `owner`                          | Reveal a card in `owner`'s hand (observer-only).   |
| `play_jeonsul_baang` | `trigger?`                       | Play a random Jeonsul Baang on a random ally.      |

### Structural

| `type`            | Fields                     | Meaning                                                          |
| ----------------- | -------------------------- | ---------------------------------------------------------------- |
| `sequence`        | `steps`                    | Resolve `steps` in order.                                        |
| `conditional`     | `if`, `then`, `otherwise?` | Resolve `then` if `if` is true, else `otherwise`.                |
| `repeat_play`     | `amount`, `cardName?`      | Queue `amount` extra plays of `cardName` next time it is played. |
| `quick`           | —                          | Card-level Quick marker (display-only).                          |
| `choose_position` | `trigger?`                 | Deploy-time decision: choose a position (cluster R).             |
| `noop`            | —                          | Explicit no-op (test placeholders).                              |

`spend_shinsu` and `grant_ability` are also structural: they wrap a nested `effect` / `ability` that is resolved (or registered) after their own step.

---

## Target grammar

Targets are canonical objects — never prose, and never a shorthand string (there is exactly one representation).

### Unit target

```yaml
target:
  side: enemy # self | bearer | ally | enemy | any
  scope: single # single | all | frontline | backline   (default single)
  count: 2 # number of units, with scope: all
  choose: true # pending decision ("of your choice")
  random: true # random selection
  condition: burned # filter: units with this condition
  conditionValue: 2 # filter: condition value threshold
  trait: taunt # filter
  rank: high ranker # filter
  position: fisherman # filter (position code)
  affiliation: khun-family # filter (affiliation code)
  attribute: anima # filter (attribute code)
  name: Rachel # filter (exact card name)
  cost: 2 # filter, or "cheapest" | "most expensive"
```

`self`/`bearer` need only `side`. `any` + `scope: all` addresses both players' units (landmark rules).

`rank`, `position`, `affiliation`, and `attribute` accept either a single value or an array of values. An array is an **OR** match ("any of these") — e.g. `attribute: [red witch, silver dwarf]` means "a Guide", and `position: [frontline shinheuh, backline shinheuh]` means "a Shinheuh".

### Card target

```yaml
card:
  zone: hand # hand | deck | discard   (default hand)
  name: Shinwonryu # exact card name
  type: unit # unit | skill | equipment
  cost: 2 # or "cheapest" | "most expensive"
  rank: high ranker
  position: fisherman
  affiliation: khun-family
  attribute: anima
  choose: true
  random: true
```

---

## Predicate grammar

Predicates are the conditions a `conditional` node (or an always-on modifier) evaluates. Each has a `type` discriminator:

| `type`              | Fields                                              | Example                                   |
| ------------------- | --------------------------------------------------- | ----------------------------------------- |
| `has_unit`          | `target`, `negate?`                                 | "if i have an allied Shinheuh"            |
| `alone_on_line`     | `line`, `negate?`                                   | "while i am alone on the ally frontline"  |
| `started_with_card` | `cardName`, `negate?`                               | "if you started the game with Ha Jinsung" |
| `has_equipped`      | `cardName`, `negate?`                               | "if i have Purple Dementor equipped"      |
| `has_all_equipped`  | `cardNames[]`, `negate?`                            | "all 4 Thorn Fragments equipped"          |
| `has_condition`     | `condition`, `conditionValue?`, `target`, `negate?` | "units with Burned 3+"                    |

---

## Modifier grammar (always-on passives)

Always-on passives and equipment-granted stat amplifiers are **modifiers**, not effects. Modifiers may appear in a unit's `passives` or an equipment's `effects`. Each has a `type` discriminator:

| `type`             | Fields                                                         | Meaning                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modify_stat`      | `stat`, `amount`, `target`, `when?`, `source?`                 | `stat`: `damage` \| `heal` \| `hp` \| `cost` \| `damage_taken`. `when` filters the affected targets (outgoing `damage`/`heal`); `source` filters the attackers (incoming `damage_taken`). |
| `modify_cost`      | `amount`, `if?`                                                | Reduces the card's own cost by `amount`.                                                                                                                                                  |
| `modify_condition` | `condition`, `amount`, `target`, `if?`                         | My abilities apply +`amount` of `condition` to matching `target`s.                                                                                                                        |
| `modify_keyword`   | `keyword`, `target`                                            | `keyword`: `quick` (abilities gain Quick).                                                                                                                                                |
| `modify_targeting` | `rule`, `target`                                               | `rule`: `ignore_taunt` \| `untargetable_by`.                                                                                                                                              |
| `global_rule`      | `rule`, `target?`, `trait?`, `condition?`, `position?`, `cap?` | Landmark-wide rule (see below).                                                                                                                                                           |

`global_rule` `rule` values: `disable_passives`, `grant_global_trait`, `grant_global_condition`, `condition_stack_cap`, `prevent_evolve`, `prevent_equip`. `position` scopes a rule to a position (`chosen` = the deploy-chosen position sentinel).

Modifiers carry their own `predicate` (via a `conditional`-style `if`) when gated — see the migration map for the exact modeling of each card.

---

## Trigger grammar

Triggers drive triggered passives and transformations (`evolveInto` / `igniteInto`). Trigger `type` values:

`equip`, `slay`, `deploy`, `given`, `kill`, `ally_dies`, `damaged_by`, `round_start`, `round_end`, `deal_damage`, `ability_used`, `attack`, `summon`, `draw`, `reclaim`, `free_ability_played`, `quick_ability_used`, `round_start_or_activation`, `skill_played`, `dies`.

`cardType` (`unit` | `skill` | `equipment`) further filters `draw` / `equip` / `reclaim` triggers to a card type. `dies` is a unit's own death (unlike `ally_dies`, which excludes self).

---

## Deck constraints

Deck constraints are authored as a top-level YAML field and compiled to the card. Each constraint requires `raw` — the player-visible text (deck constraints are not effects, so their text lives here):

```yaml
deckConstraints:
  - type: unreachable
    raw: "i am Unreachable"
  - type: generated_by
    resource: fire_charge
    amount: 5
    raw: "create me by spending 5 Fire Charges"
```

- `unreachable` — cannot be included in a constructed deck; may still be created during play.
- `generated_by` — created during play by spending a resource (Hwayeomsa Incinerates).

---

## Compiled representation

The compiler normalizes human-readable vocab into codes before emitting `cards.json`:

| Source value   | Compiled code  |
| -------------- | -------------- |
| `light bearer` | `light-bearer` |
| `high ranker`  | `high ranker`  |
| `silver dwarf` | `silver-dwarf` |
| `khun family`  | `khun-family`  |

The compiled schema is **closed**: `type` must be a known node type, unknown fields are rejected, and there is no `custom` type and no `handler` field. The runtime throws on any `type` with no registered handler.

> **Transitional behavior** — while handlers are being brought online per `type`, a node whose `type` is valid but unregistered emits `EFFECT_UNSUPPORTED` and is skipped. Once the catalog is fully implemented, the runtime throws on any unregistered `type`.

---

## Migration

The full inventory and classification of the legacy `type: "custom"` effects, and each card's target DSL, is in [`plans/effect-migration-map.md`](../plans/effect-migration-map.md).

---

## Anti-patterns

- **Don't parse `raw`** — it is display text only.
- **Don't hardcode card IDs** — they shift when cards change.
- **Don't author effects as prose** — always use a structured node.
- **Don't mutate the compiled data** — treat it as read-only.
- **Don't add a handler per card** — handlers map one-to-one to `type`, not to cards.
