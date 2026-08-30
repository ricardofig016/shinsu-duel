# Card Effect DSL — Shinsu Duel

This document is the authoritative contract for **card effect authoring and the compiled DSL**. It defines the structured grammar that card authors write in YAML and the normalized form the runtime engine consumes from `server/data/cards.json`.

---

## Overview

Cards are authored as YAML in `data/cards/` and compiled to a single `server/data/cards.json`. That file is the **sole runtime data source** — the game engine never reads YAML directly.

| Source                | Compiled                 | Validated by                                                                                                 |
| --------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `data/cards/**/*.yml` | `server/data/cards.json` | `scripts/card-validate.js` + `schemas/card.schema.json` (YAML) → `schemas/compiled-cards.schema.json` (JSON) |

`schemas/dsl-catalog.json` is the canonical machine-readable inventory of every node, trigger, predicate, and deck-constraint discriminator, together with the runtime owner each category requires. The compiler validates types against it (see [Node catalog](#node-catalog)).

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
- The compiler **fails loudly** on any node, trigger, or predicate `type` outside `schemas/dsl-catalog.json`, at the exact source path that introduced it — including nested nodes. There is no `custom` fallback and no `handler` field — the handler registry maps `type` to a handler class, one per type.
- `type` is the single bridge between a compiled node and its runtime handler.

---

## Node catalog

`schemas/dsl-catalog.json` lists every accepted discriminator and the owner each category requires:

| Category          | Required owner                                                            |
| ----------------- | ------------------------------------------------------------------------- |
| `structural`      | `EffectResolver` resolves `sequence`/`conditional` inline                  |
| `markers`         | Registered display-only handlers (`noop`, `quick`)                         |
| `effects`         | One handler per type in `HandlerRegistry`                                  |
| `modifiers`       | `ModifierService` applies and revokes always-on modifiers                  |
| `rules`           | `GlobalRuleRegistry` registers landmark rules                              |
| `predicates`      | `PredicateEvaluator` evaluates conditional/modifier gates                  |
| `triggers`        | `TriggerManager` (transformations), `PassiveManager` (triggered passives)  |
| `deckConstraints` | Deck-construction validation                                               |

Three checks keep the catalog, both schemas, and the compiler in lockstep (`npm run test -- DslCatalogContract CardDataAudit`):

- **Schema drift** — every discriminator in `schemas/card.schema.json` and `schemas/compiled-cards.schema.json` must appear in the catalog, and every catalog entry must be accepted by both schemas.
- **Compiler recognition** — the compiler refuses any type outside the catalog, so a catalog entry can never be silently un-compilable.
- **Runtime ownership** — the shipped-data audit fails while any dispatchable effect type used by shipped cards has no registered handler. Schema validity therefore never implies runtime support.

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
| `triggers` | passives                     | Multiple single-event triggers; each entry is wired independently to its own event (no compound trigger types). |

Top-level entries (`abilities`, skill/equipment `effects`, and `passives`) require `raw`. Nested nodes (`sequence.steps[]`, `spend_shinsu.effect`, `grant_ability.ability`, `conditional.then/otherwise`) omit `raw`.

### Card metadata

Unit cards carry an archetype discriminator plus a field line, alongside the shared metadata below:

- `kind` — what a unit fundamentally is on the board: `standard | shinheuh | landmark | conduit`. `standard` (the default) occupies a main position and carries a `rank`; the special kinds carry no position and no rank. Normalized like `affiliations` (dash-cased code).

- `line` — a special kind's field line: `frontline | backline`. Only shinheuh author it (`bull`/`stone_doll` = frontline); landmarks and the conduit are backline by kind; a standard unit's line derives from its chosen position at deploy.

- `entryHp` — optional, unit-only HP the unit enters play with instead of its full HP. Must not exceed `hp`; the bound is compiler-enforced because JSON Schema cannot compare two fields, and the compiler rejects `entryHp` on non-unit cards outright. It is consumed exactly once at unit creation and never re-applied: transformation re-derives HP from the preserved lost-HP delta. Cards without it carry no `entryHp` key in compiled data; the runtime `Card` exposes it as `null` there and through serialization.

- `rules` — a **landmark-only** list of always-on battlefield rules (see [Rules grammar](#rules-grammar)). These are distinct from `passives`: rules are board-wide and always-on, while a landmark's triggered effects stay in `passives`.

Shared metadata:

- `series` — an explicit grouping key for related cards (e.g. `incinerate` for Incinerate I–IV, `thorn-fragment` for First–Fourth Thorn Fragment). It is a first-class data contract, not a name convention: cards in the same series declare the same `series` code explicitly, and card targets reference a series via `card.series`. Normalized like `affiliations` (dash-cased code).

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

| `type`            | Fields             | Meaning                                       |
| ----------------- | ------------------ | --------------------------------------------- |
| `charge_shinsu`   | `amount`           | Regain `amount` normal shinsu.                |
| `spend_shinsu`    | `amount`, `effect` | Spend `amount` shinsu, then resolve `effect`. |
| `compress_shinsu` | `amount`, `card`   | Reduce a card's cost by `amount`.             |
| `reclaim_cards`   | `amount`, `card?`  | Put `amount` cards from discard into hand.    |
| `light_up`        | `amount`           | Heal `amount` HP from ally lighthouses.       |
| `extinguish`      | `amount`, `owner?` | Deal `amount` damage to enemy lighthouses.    |

### Cards and zones

| `type`            | Fields                            | Meaning                                                                                                                                                                                                 |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `draw_card`       | `amount`, `card?`                 | Draw `amount` cards (optionally filtered by `card`).                                                                                                                                                    |
| `create_card`     | `card`                            | Create a card in hand. Exact `card.name` (optionally `card.type`) creates that card; `card.series` creates any card in that series (optionally `choose`/`random`).                                      |
| `summon`          | `card`, `from`, `onto`, `random?` | Put a unit onto a battlefield (`from`: `deck`, `hand`, `deck_or_hand`, or `game` = all existing cards).                                                                                                 |
| `discard`         | `card`, `owner`                   | Send a card from an owner's hand to their discard.                                                                                                                                                      |
| `steal`           | `card`                            | Take a card from the opponent into your control.                                                                                                                                                        |
| `disarm`          | `target`, `to`                    | Send a unit's equipment to a destination. `to` is an object: `{ zone, owner }` — `zone`: `hand` \| `discard`; `owner`: `equipment_owner` (the disarmed unit's controller) \| `you` (the acting player). |
| `switch_position` | `target`                          | Force a unit to switch positions.                                                                                                                                                                       |

`return_to_hand` (`target`) returns a unit from the battlefield to its owner's hand.

### Units

| `type`               | Fields                                     | Meaning                                                                                                                                                                                       |
| -------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deal_damage`        | `amount`, `target`                         | Deal `amount` damage.                                                                                                                                                                         |
| `heal`               | `amount`, `target`                         | Heal `amount` HP.                                                                                                                                                                             |
| `activate`           | `amount?`, `target`                        | Emit the Activation event for `target` `amount` times (default 1), re-firing that unit's `activation`-triggered passives and transformations.                                                  |
| `give_condition`     | `condition`, `amount?`, `target`           | Apply a condition (optionally stacked).                                                                                                                                                       |
| `remove_conditions`  | `target`, `mode?`, `amount?`, `condition?` | Remove conditions from `target`. `mode`: `all` (default) \| `random` \| `choose`; `amount` = how many (required for `random`/`choose`); `condition` = restrict to one condition.              |
| `grant_trait`        | `trait`, `amount?`, `target`               | Grant a trait (optionally numeric).                                                                                                                                                           |
| `remove_traits`      | `target`, `trait?`                         | Remove all traits, or one named `trait` (Silence).                                                                                                                                            |
| `copy_traits`        | `target`, `source`                         | Copy traits from `source` onto `target`.                                                                                                                                                      |
| `grant_random_trait` | `target`, `numeric?`                       | Grant a random trait.                                                                                                                                                                         |
| `slay`               | `target`                                   | Kill units directly (ignores damage).                                                                                                                                                         |
| `transform`          | `cardName`                                 | Replace the unit with another card (revert).                                                                                                                                                  |
| `grant_ability`      | `ability`, `target`                        | Grant an ability (register, don't execute).                                                                                                                                                   |
| `copy_ability`       | `source`                                   | Use a copy of an enemy `source`'s ability.                                                                                                                                                    |
| `peek_hand`          | `owner`, `card?`, `mode?`, `amount?`       | Reveal cards in `owner`'s hand (observer-only). `card` filters eligible cards; `mode` (`all` \| `random` \| `choose`) + `amount` select how many; a bare peek reveals one seeded-random card. |
| `play_jeonsul_baang` | `trigger?`                                 | Play a random Jeonsul Baang on a random ally.                                                                                                                                                 |

`grant_affiliation` (`target`, `source`) grants `target` an affiliation taken from `source` (a `source` descriptor with `random: true` picks a random source unit).

The `summon`/`discard`/`steal`/`disarm`/`switch_position` primitives route through the same authoritative engines as deployment and equipment: `summon` resolves `from` (deck | hand | deck_or_hand | game) and `onto` (self | opponent | both); `steal` moves a matched enemy unit onto the acting player's field; `discard` discards a hand card, or bearer equipment when `card.zone: attachments`; `disarm` routes equipment by `to` (`{ zone: hand|discard, owner: equipment_owner|you }`); `switch_position` targets enemies that can legally switch (`can_switch: true`).

### Remove conditions

`remove_conditions` removes condition types (the distinct condition keys a unit carries — all stacked sources of a condition are removed together) from `target`. The `Cleanse` keyword (`remove all conditions`) is `mode: all`, the default. Three modes:

```yaml
- type: remove_conditions
  target: { side: ally } # remove ALL conditions (classic Cleanse)
- type: remove_conditions
  mode: random
  amount: 1
  target: { side: ally } # remove 1 random condition
- type: remove_conditions
  mode: choose
  amount: 2
  target: { side: ally } # owner chooses 2 conditions to remove
- type: remove_conditions
  condition: burned
  target: { side: enemy } # remove only Burned (all its stacks)
```

- `mode` defaults to `all` (a bare `remove_conditions` removes every condition).
- `amount` is required and must be ≥ 1 when `mode` is `random` or `choose`; it is ignored for `all`. If `amount` exceeds the eligible conditions, every eligible condition is removed (clamp to "up to N").
- `condition` (optional) restricts the eligible pool to a single named condition, and composes with any `mode`.
- `random` selection is deterministic via the seeded RNG; `choose` creates a `remove_conditions` pending decision for the acting player.

`condition` here is the remove selector (which condition to remove), distinct from `target.condition`, which filters which units are eligible targets.

### Structural

| `type`            | Fields                     | Meaning                                                                                                                |
| ----------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `sequence`        | `steps`, `targets?`        | Resolve `steps` in order; `targets` resolves one shared target set for link steps.                                     |
| `conditional`     | `if`, `then`, `otherwise?` | Resolve `then` if `if` is true, else `otherwise`.                                                                      |
| `repeat_play`     | `amount`, `cardName?`      | Queue `amount` extra plays of `cardName` next time it is played; without `cardName`, the next card played is replayed. |
| `quick`           | —                          | Card-level Quick marker (display-only).                                                                                |
| `choose_position` | `trigger?`                 | Deploy-time decision: choose one canonical standard position; the chosen code is stored on the unit. |
| `noop`            | —                          | Explicit no-op (test placeholders).                                                                                    |

`spend_shinsu` and `grant_ability` are also structural: they wrap a nested `effect` / `ability` that is resolved (or registered) after their own step.

A `sequence` may declare a shared `targets` descriptor (a side-based unit target). The target set is resolved once — filters, line blocking, Taunt, Blinded, and the choice/random selection — and steps reference it with a **link** target: `target: { link: sequence }` acts on every shared target, while `target: { link: sequence, count: N }` acts on a player-chosen subset (e.g. "give Burned 1 to one of them").

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
  traitNot: immune # filter: units WITHOUT this trait
  lowest_hp: true # keep only the lowest-HP match (ties → first in field order)
  shared_affiliation: true # filter: units sharing >=1 affiliation with the source unit
  rank: high ranker # filter
  position: fisherman # filter (position code)
  affiliation: khun-family # filter (affiliation code)
  attribute: anima # filter (attribute code)
  name: Rachel # filter (exact card name)
  kind: shinheuh # filter (card archetype)
  line: frontline # filter (field line)
  cost: 2 # filter, or "cheapest" | "most expensive"
  has_passive: true # filter: units with >=1 passive ability
  can_switch: true # filter: units with a legal other printed position (non-full line)
  exclude_self: true # ally filter: exclude the source unit
```

`self`/`bearer` need only `side`. `any` + `scope: all` addresses both players' units (landmark rules).

`side: ally` means any unit on the source's side, including the source unit itself. There is no self-exclusion. `scope: all` maps to `all_allies`; `scope: frontline`/`backline` narrows ally targets by field line (via the `line` filter). `exclude_self: true` targets an ally other than the source unit; with no source unit (a skill), it is a no-op.

`side: enemy` with `count > 1` (no `scope`, or `scope: single`) selects N enemy units and is normalized to the `enemies` descriptor: targetable Taunt units are locked as mandatory and the player chooses only the remaining free (non-Taunt) slots. When the Taunt units already satisfy `count`, or when every remaining candidate is forced, the selection auto-resolves with no decision. When there are more Taunt units than `count`, the player chooses `count` among them. `side: enemy` with no count (or `count: 1`) is the single-target `enemy` descriptor and is Taunt-collapsed. `random: true` selects targets automatically via the seeded RNG (no decision); a `Blinded` source is treated the same way, with Taunt still enforced for enemy targets.

`shared_affiliation: true` keeps only units that share at least one affiliation with the source unit (its native `card.affiliations` plus any affiliation granted via the ModifierStack). The source unit itself counts. If the source has no affiliations, the filter matches nothing.

`has_passive: true` keeps only units whose card declares at least one passive ability ("Silence an enemy that has at least one passive"). `can_switch: true` keeps only units that can legally switch position — at least one printed position other than the current one whose destination line is not full.

`rank`, `position`, `affiliation`, `attribute`, and `kind` accept either a single value or an array of values. An array is an **OR** match ("any of these") — e.g. `attribute: [red witch, silver dwarf]` means "a Guide", and `kind: shinheuh` means "a Shinheuh". `line` filters by field line.

A step inside a shared-target `sequence` uses a **link** target instead of a side descriptor: `target: { link: sequence }` (all shared targets) or `target: { link: sequence, count: N }` (a subset). Link targets are only valid on steps of a `sequence` that declares `targets`.

### Card target

```yaml
card:
  zone: hand # hand | deck | discard | attachments (explicit source-zone override; defaults to the effect's natural zone)
  name: Shinwonryu # exact card name (exclusive with `series`)
  series: thorn-fragment # exact series code (exclusive with `name`)
  type: unit # unit | skill | equipment
  cost: 2 # or "cheapest" | "most expensive"
  rank: high ranker
  position: fisherman
  affiliation: khun-family
  attribute: anima
  kind: shinheuh # filter: card archetype
  line: frontline # filter: field line (shinheuh only)
  choose: true
  random: true
```

`name` is an exact card-name match; `series` is an exact series-code match (cards declare `series` at the card level). A card target uses one or the other, never both. `zone` selects the source zone to search; when omitted it defaults to the effect's natural zone (`compress_shinsu` → hand, `draw_card` → deck, `reclaim_cards` → discard, `discard` → hand). `zone: attachments` targets the source unit's attached equipment (used by `discard` to discard bearer equipment, e.g. the Thorn Fragments).

---

## Predicate grammar

Predicates are the conditions a `conditional` node (or an always-on modifier) evaluates. Each has a `type` discriminator:

| `type`              | Fields                                              | Example                                   |
| ------------------- | --------------------------------------------------- | ----------------------------------------- |
| `has_unit`          | `target`, `negate?`                                 | "if i have an allied Shinheuh"            |
| `alone_on_line`     | `line`, `negate?`                                   | "while i am alone on the ally frontline"  |
| `started_with_card` | `cardName`, `negate?`                               | "if you started the game with Ha Jinsung" |
| `has_equipped`      | `cardName`, `negate?`                               | "if i have Purple Dementor equipped"      |
| `has_all_equipped`  | `series`, `negate?`                                 | "equipped with every card in a series"    |
| `has_condition`     | `condition`, `conditionValue?`, `target`, `negate?` | "units with Burned 3+"                    |

`has_unit` and `has_condition` are existence checks: they read the whole board and ignore offensive-targeting rules (frontline blocking, Taunt, Blinded). A matching source unit counts toward the check — "an allied Guide" on a Guide unit includes itself.

`has_equipment_count` (`amount`, `negate?`) is true when the source unit has at least `amount` equipments attached.

---

## Modifier grammar (always-on passives)

Always-on passives and equipment-granted stat amplifiers are **modifiers**, not effects. Modifiers may appear in a unit's `passives` or an equipment's `effects`. Each has a `type` discriminator:

| `type`             | Fields                                                      | Meaning                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modify_stat`      | `stat`, `amount`, `target`, `when?`, `source?`, `cardType?` | `stat`: `damage` \| `heal` \| `hp` \| `cost` \| `damage_taken`. `when` filters the affected targets (outgoing `damage`/`heal`); `source` filters the attackers (incoming `damage_taken`). `cardType` (unit\|skill\|equipment) scopes a `cost` modifier to a card type.       |
| `modify_cost`      | `amount`, `if?`                                             | Reduces the card's own cost by `amount`.                                                                                                                                                                                                                                     |
| `modify_condition` | `condition`, `amount`, `target`, `if?`                      | My abilities apply +`amount` of `condition` to matching `target`s.                                                                                                                                                                                                           |
| `modify_keyword`   | `keyword`, `target`, `first?`                               | `keyword`: `quick` \| `free` (abilities gain that keyword). `first: true` limits it to the first ability used each round.                                                                                                                                                    |
| `modify_targeting` | `rule`, `target`                                            | `rule`: `ignore_taunt` \| `untargetable_by`.                                                                                                                                                                                                                                 |
| `modify_ability`   | `target`, `effect`, `position?`, `if?`                      | `target` selects whose abilities are augmented; when such a unit's ability targets the side in `effect.target`, also resolve `effect` against that target — once per target per trigger (a `modify_repeat` re-applies it per trigger; a multi-step ability applies it once). |

Two additional modifier types exist: `modify_repeat` (`amount`, `target`) — the target's abilities trigger `amount` times — and `retain_equipment` (no fields) — the unit keeps its equipment when it returns to hand.

Modifiers carry their own `predicate` (via a `conditional`-style `if`) when gated — see the migration map for the exact modeling of each card. A modifier's `position` (where present) scopes it to the source unit's current position and is enforced at application time, for equipment `effects` and passives alike.

## Rules grammar (landmark-only)

A landmark's always-on battlefield rules are authored as a top-level `rules` list of `ruleNode` entries — distinct from passives, which are unit-scoped. Each rule has a `type` discriminator:

| `type`                   | Fields                   | Meaning                                                                |
| ------------------------ | ------------------------ | ---------------------------------------------------------------------- |
| `disable_passives`       | —                        | Unit passives have no effect on the board.                             |
| `grant_global_trait`     | `trait`, `position?`     | Every unit (optionally in `position`, incl. `chosen`) has `trait`.     |
| `grant_global_condition` | `condition`, `position?` | Every unit (optionally in `position`, incl. `chosen`) has `condition`. |
| `condition_stack_cap`    | `cap`                    | Conditions do not stack past `cap`.                                    |
| `prevent_evolve`         | `position?`              | Units (optionally in `position`) cannot evolve.                        |
| `prevent_equip`          | `position?`              | Units (optionally in `position`) cannot be equipped.                   |

`position` scopes a rule to a main position or the `chosen` sentinel. `chosen` reads the source landmark's stored `chosenPositionCode`; the registry does not activate that rule before a choice exists. Rules affect both boards and current or future matching units. A unit with no placed position does not match a position scope. Irregulars ignore every landmark rule.

Rules are registered and revoked by the landmark source ID while the landmark is in play. Global trait and condition rules generate separate source-owned modifiers. The registry rebuilds them after relevant lifecycle changes. Condition grants use the normal condition application path, so Immune and condition-stack caps still apply.

---

## Trigger grammar

Triggers drive triggered passives and transformations (`evolveInto` / `igniteInto`). Trigger `type` values:

`equip`, `slay`, `deploy`, `given`, `kill`, `ally_dies`, `enemy_dies`, `damaged_by`, `round_start`, `round_end`, `deal_damage`, `ability_used`, `summon`, `draw`, `reclaim`, `free_ability_played`, `quick_ability_used`, `activation`, `skill_played`, `dies`, `evolve`, `has_all_equipped`.

`cardType` (`unit` | `skill` | `equipment`) further filters `draw` / `equip` / `reclaim` triggers to a card type. `dies` is a unit's own death; `ally_dies` and `enemy_dies` are an ally's / enemy's death respectively (optionally filtered by `rank`). An `ally_dies` trigger includes the source unit's own death per the ally definition, and passive death triggers fire on `unit:killed` — the lethal pipeline announces the death while the dying unit's own passives are still subscribed, so a self-`dies` passive resolves. Non-death removals (substitution, landmark replacement, returning to hand) never fire them. `draw` fires for any card draw, including the round-start draw; `reclaim` fires for effect-driven reclaims; `free_ability_played` fires when an ability with Free is used. `evolve` fires on the `unit:evolving` announcement that precedes an evolution and never on a `transform`-effect revert; `has_all_equipped` carries `cardNames[]` and fires when the unit is equipped with every listed card. `activation` fires on the `unit:activation` event and only for the unit that event names (`payload.unitId`), so an `activate` effect replays the target's passives without touching other copies of the card.

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

The compiled schema is **closed**: `type` must be a known node type, unknown fields are rejected, and there is no `custom` type and no `handler` field. The compiler additionally refuses any `type` outside `schemas/dsl-catalog.json` at the source path that introduced it.

Artwork is resolved at compile time: for each card the compiler looks for `<normalizeName(name)>.png` in `public/assets/images/artworks/` (the same slug that names the YAML source) and stamps the public path into the compiled card as `artworkPath`. The field is present only when the file exists — cards without artwork carry no `artworkPath` at all, and the frontend renders its placeholder for them. The authoring rules for artwork files live in [`CARD_AUTHORING.md`](./CARD_AUTHORING.md).

> **Transitional behavior** — a node whose `type` is cataloged but whose handler is not yet registered emits `EFFECT_UNSUPPORTED` and is skipped at runtime. The runtime ownership coverage test in [`CardDataAudit.test.js`](../server/game/tests/integration/CardDataAudit.test.js) fails for every such type until its handler is registered; do not treat a passing schema check as runtime support.

---

## Compiled artifact audit

[`server/game/tests/integration/CardDataAudit.test.js`](../server/game/tests/integration/CardDataAudit.test.js) audits the shipped data on every test run:

- a fresh in-memory compile (`compileCards()` in `scripts/card-compile.js`) must equal the checked-in `server/data/cards.json` exactly — same content, same stable name-sorted `cardId`s;
- every node, trigger, and predicate type in the compiled data must be cataloged;
- every dispatchable effect type must have a registered handler (see the transitional note above);
- identity is unique (names and `cardId`s) and evolution/ignition cross-references point at their conventioned counterparts;
- every compiled `artworkPath` is absent or exactly `/assets/images/artworks/<normalizeName(name)>.png` (the artwork slug contract).

The audit is read-only: it never rewrites the artifact. If it fails after editing cards, run `npm run compile:cards` to refresh `server/data/cards.json`.

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
