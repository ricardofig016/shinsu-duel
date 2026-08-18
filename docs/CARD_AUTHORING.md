# Card Authoring — Shinsu Duel

This document is the **entry point** for anyone modifying cards or rules. It does not restate grammar, game rules, or runtime internals — those live in their authoritative files, which this document routes you to. It covers only what those files don't: **how to find the right source of truth for your task**, and the **raw text conventions** that keep card prose consistent.

---

## Pick your task

Read the listed files **in order**. Each task needs a different subset; you rarely need everything.

### Add a new card

1. [`RULES.md`](../RULES.md) — the game vocabulary (keywords, conditions, traits, positions, attributes) and mechanics the card must match.
2. [`docs/COMPILED_CARD_DSL.md`](./COMPILED_CARD_DSL.md) — the full structured-node grammar (nodes, targets, predicates, modifiers, triggers, deck constraints, keywords).
3. [`scripts/card-create.js`](../scripts/card-create.js) — the scaffold for a new card (`npm run create:card <type> <name>`).
4. [`scripts/card-validate.js`](../scripts/card-validate.js) — **domain rules the schema does not enforce**: allowed affiliations/traits/positions/attributes, rank→cost ranges, filename convention, evolution/ignition cross-reference existence.
5. Copy an existing card of the same type as a structural template (see _Reference cards_ below).

### Modify an existing card's effect

1. [`docs/COMPILED_CARD_DSL.md`](./COMPILED_CARD_DSL.md) — the node/field grammar for the effect you are changing.
2. The card's own YAML in [`data/cards/`](../data/cards/) plus its nearest structural neighbor.
3. [`scripts/card-compile.js`](../scripts/card-compile.js) — normalization rules (code mapping, cross-refs, cardId assignment) that constrain how you author.

### Modify an existing rule / mechanic

1. [`RULES.md`](../RULES.md) — the rule itself (this is the authoritative spec; cards are made to match it).
2. The subsystem doc that owns the behavior — see the architecture docs list in [`README.md`](../README.md) and `docs/`.
3. The implementing runtime file (e.g. [`TargetResolver.js`](../server/game/TargetResolver.js) for targeting rules) — a rule change is a code change, not a card change.

### Add a new rule / new effect type

1. [`docs/COMPILED_CARD_DSL.md`](./COMPILED_CARD_DSL.md) + both schemas (`schemas/card.schema.json`, `schemas/compiled-cards.schema.json`) — the contract you must extend.
2. [`docs/HANDLER_SYSTEM_ARCHITECTURE.md`](./HANDLER_SYSTEM_ARCHITECTURE.md) — how a new `type` maps to a handler and registers in [`EffectResolver.js`](../server/game/EffectResolver.js).
3. [`docs/SERVICE_LAYER_ARCHITECTURE.md`](./SERVICE_LAYER_ARCHITECTURE.md) — the authoritative services any new mutation must delegate to.
4. [`AGENTS.md`](../AGENTS.md) — mandatory process for rules changes (test + regression + docs discipline).

### Reference cards

Structural patterns live in the existing cards — read the closest match before authoring:

| Need                                         | Reference                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Minimal unit / skill / equipment             | `data/cards/units/rachel.yml`, `data/cards/skills/healing_potion.yml`, `data/cards/equipments/frog_fisher.yml` |
| Evolution pair                               | `data/cards/units/karaka.yml` + `karaka_evolved.yml`                                                           |
| Ignition pair                                | `data/cards/equipments/narumada.yml` + `narumada_ignited.yml`                                                  |
| Landmark / Shinheuh / special                | `data/cards/units/floor_of_death.yml`, `stone_doll.yml`, `conduit.yml`                                         |
| Identity keyword with display text           | `data/cards/skills/lightning_baang.yml`                                                                        |
| Deck constraint (`generated_by`)             | `data/cards/skills/incinerate_iv.yml`                                                                          |
| Structured triggers / modifiers              | `data/cards/units/karaka_evolved.yml`, `wooden_horse.yml`, `evan_edrok.yml`                                    |
| Compound chains (`sequence` / `conditional`) | `data/cards/units/ja_wangnan.yml`, `data/cards/skills/baang.yml`                                               |

---

## The one caveat every author must know

**`npm run validate:cards` passing does not mean a card works at runtime.** The schema and compiler validate _shape_; they do not guarantee a handler exists for every `type`.

The definitive list of implemented node types is **not in this file and not in the schema** — it is the registry in [`server/game/EffectResolver.js`](../server/game/EffectResolver.js) (for effects), [`server/game/services/PassiveManager.js`](../server/game/services/PassiveManager.js) (for passive triggers), and [`server/game/ModifierStack.js`](../server/game/ModifierStack.js) (for always-on modifiers). Before authoring an effect, confirm its `type` is registered; unregistered types currently emit `EFFECT_UNSUPPORTED` and do nothing. See the "Transitional behavior" note in [`COMPILED_CARD_DSL.md`](./COMPILED_CARD_DSL.md).

Corollary: `server/data/cards.json` is a **build artifact** (currently the legacy pre-migration set) — never hand-edit it. Regenerate with `npm run compile:cards`.

---

## Raw text conventions

`raw` is player-visible display text. It is never parsed, but it must read consistently. Follow these conventions from the existing card set; when unsure, match the phrasing of the nearest reference card.

### Voice and case

- **First person for the card itself**: `i` / `me` / `my` — "heal me 3 HP", "i deal +1 damage", "give me Ghost".
- **Second person for the controlling player**: `you` / `your` — "in your hand", "from your deck".
- **Third person for the bearer** (equipment): `the bearer` — "the bearer has Pierce 1".
- **Keywords are capitalized**; effect verbs are lowercase: `deal`, `heal`, `give`, `draw`, `summon`, `create`, `steal`, `spend`, `force`. Capitalized keywords: `Create`/`Destroy` (lighthouses), `Reclaim`, `Compress`, `Charge`, `Slay`, `Disarm`, `Silence`, `Cleanse`, `Quick`, `Free`, plus all condition and trait names (`Burned`, `Rooted`, `Taunt`, …).
- **Amounts are digits**, never words — `deal 4`, `heal 2 HP`, `Burned 3+`.

### Canonical phrasings by effect

| Intent                         | Canonical form                                                                    | Examples                                                                                                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Damage                         | `deal {n} to {target}`                                                            | `deal 4 to an enemy`, `deal 2 to 2 enemies`, `deal 3 to all enemies`, `deal 3 to a frontline enemy`, `deal 3 to all Rooted enemies`, `deal 3 to an enemy with Exhausted` |
| Heal                           | `heal {target} {n} HP`                                                            | `heal an ally 5 HP`, `heal me 3 HP`, `heal the bearer 2 HP`, `heal a team sweet and sour member 1 HP`, `heal enemy Conduit 2 HP`                                         |
| Give a condition (numeric)     | `give {Condition} {n} to {target}`                                                | `give Burned 1 to an enemy`, `give Poisoned 1 to a backline enemy`                                                                                                       |
| Give a condition (non-numeric) | `give {target} {Condition}`                                                       | `give an enemy Doomed`, `give me Ghost`                                                                                                                                  |
| Grant a trait                  | `give {target} {Trait} {n}` / `the bearer has {Trait} {n}` / `i have {Trait} {n}` | `give ally Bull Strong 2`, `the bearer has Pierce 1`, `i have Strong 3`, `give me Ruthless 1`                                                                            |
| Cleanse                        | `Cleanse {target}`                                                                | `Cleanse an ally`, `Cleanse all allies`, `Cleanse the bearer`                                                                                                            |
| Remove condition(s)            | `remove {n} condition(s) from {target}` / `remove {Condition} from {target}`      | `remove a condition from an ally`, `remove Burned from an enemy`, `remove 2 random conditions from an ally`                                                              |
| Create lighthouses             | `Create {n}`                                                                      | `Create 1`, `Create 3`                                                                                                                                                   |
| Destroy lighthouses            | `Destroy {n}`                                                                     | `Destroy 1`                                                                                                                                                              |
| Reclaim                        | `Reclaim {n} [filter]`                                                            | `Reclaim 2 equipments`, `Reclaim 1 Equipment card`, `Reclaim 1`                                                                                                          |
| Compress cost                  | `Compress {n} from {card}`                                                        | `Compress 1 from a Hwayeomsa in your hand`, `Compress 1 from the most expensive card in your hand`                                                                       |
| Charge shinsu                  | `Charge {n}`                                                                      | `Charge 1`                                                                                                                                                               |
| Slay                           | `Slay {target}`                                                                   | `Slay an enemy Regular or Ranker`, `Slay all enemies with Burned 3+`                                                                                                     |
| Create a card                  | `create {Name} in your hand`                                                      | `create Shinwonryu in your hand`, `create a Thorn Fragment of your choice in hand`, `create me by spending 1 Fire Charge`                                                |
| Draw                           | `draw {filter}`                                                                   | `draw an equipment of your choice`                                                                                                                                       |
| Summon                         | `summon {Name/descriptor} from your {deck or hand}`                               | `summon a random 2 cost Shinheuh`, `summon Akryung from your deck or hand`                                                                                               |
| Steal                          | `steal {descriptor}`                                                              | `steal the enemy's cheapest Shinheuh`                                                                                                                                    |
| Disarm                         | `Disarm {target} and send the equipment to {your discard pile}`                   | `Disarm an enemy and send the equipment to your discard pile`                                                                                                            |
| Switch position                | `force {target} to switch positions`                                              | `force an enemy to switch positions`                                                                                                                                     |
| Silence                        | `Silence {target}`                                                                | `Silence an enemy`, `Silence me`                                                                                                                                         |
| Peek hand                      | `see a random card in the opponent's hand`                                        | —                                                                                                                                                                        |
| Copy ability                   | `use an enemy ability`                                                            | `spend 2: use an enemy ability`                                                                                                                                          |

### Targets

- Singular enemy: `an enemy`. Multiple: `2 enemies`, `all enemies`. Line-scoped: `a frontline enemy`, `a backline enemy`. Filtered: `all Rooted enemies`, `2 Burned enemies`.
- Ally: `an ally`, `all allies`, `me`, `the bearer`.
- Affiliations keep their natural casing as proper nouns: `team sweet and sour`, `karaka's servants`, `yeon family`.

### Prefixes and scope

- **Spend**: `spend {n}: {effect}` — `spend 1: deal 6 to an enemy`.
- **Position scope**: `{position}: {effect}` — `fisherman: deal 1 to an enemy`, `light bearer: create 1`.
- **Quick / Free**: as an ability prefix `quick: {effect}`, or as a standalone marker `i am Quick` / `Free: Spend 1: deal 1 to an enemy`.
- **Triggered passives** lead with the trigger, then a colon: `round start: …`, `round end: …`, `when {event}`, `whenever {event}`, `when i die`, `when i'm equipped with X`, `when you summon a Shinheuh`.
- **Conditionals**: `if {condition}, {effect}`, or with an `otherwise` branch: `if you have an ally Wave Controller deal 2 to an enemy, otherwise deal 1`. Always-on gates use `while`: `while i am alone on the ally frontline, i have Resilient 1 and Strong 3`.

### Identity and metadata markers

- `i am Unreachable` (deck constraint), `i am Quick` (Quick keyword), `i am a Jeonsul Baang` (identity keyword) — the `i am …` form is reserved for these markers.
