## Plan: Project Resurrection - Comprehensive Rebuild Plan

**TL;DR**: Multipronged, phased rewrite of the Shinsu Duel game engine. Keep the networking/web layer (~90%), replace the game logic layer (~80%). Plan spans 6 phases over multiple implementation sessions, ordered by dependency and risk.

---

## Progress Tracker

| Phase                  | Status      | Notes |
| ---------------------- | ----------- | ----- |
| 0 — Data Pipeline      | not started |       |
| 1 — EventBus           | not started |       |
| 2 — GameState          | not started |       |
| 3 — Actions            | not started |       |
| 4 — Abilities/Passives | not started |       |
| 5 — Testing            | not started |       |
| 6 — Frontend           | not started |       |

---

## Phase 0: Foundation & Data Pipeline

**Goal**: Establish the correct data model and card compilation pipeline before touching any game logic.

### Tracker

| #    | Step                                            | Done? |
| ---- | ----------------------------------------------- | ----- |
| 0.0  | Move YAML files to `data/cards/`                | [ ]   |
| 0.1  | Create `data/cards/schema.json`                 | [ ]   |
| 0.2  | Rewrite card-validate script                    | [ ]   |
| 0.3  | Rewrite card-create script                      | [ ]   |
| 0.4  | Rewrite card-lookup script                      | [ ]   |
| 0.5  | Create compile-cards script                     | [ ]   |
| 0.6  | Update package.json script paths                | [ ]   |
| 0.7  | Add `npm run compile:cards`                     | [ ]   |
| 0.8  | Compile, validate, fix                          | [ ]   |
| 0.9  | All tests pass                                  | [ ]   |
| 0.10 | Create `server/data/conditions.json`            | [ ]   |
| 0.11 | Check data files vs RULES.md, fix discrepancies | [ ]   |
| 0.12 | Create `ICONS_TODO.md`, flag missing icons      | [ ]   |

### What Changes

| File                                  | Action                        | Notes                                                                                                                                          |
| ------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/cards/*.yml`                    | **MOVE** → `data/cards/*.yml` | Source of truth stays YAML; move from docs/ to project root data/                                                                              |
| `docs/scripts/*.js`                   | **MOVE** → `scripts/card-*`   | Move alongside; update package.json script paths                                                                                               |
| `server/data/cards.json`              | **REGENERATE**                | New schema with all RULES.md fields                                                                                                            |
| `server/data/affiliations.json`       | **EXPAND**                    | May be missing/outdated, check with source of truth RULES.md                                                                                   |
| `server/data/traits.json`             | **REVIEW**                    | trait definitions                                                                                                                              |
| **NEW** `server/data/conditions.json` | **CREATE**                    | Conditions - new standalone data file with the same structure pattern as traits/affiliations. All 11 conditions from RULES.md must be present. |
| `server/data/attributes.json`         | **EXPAND**                    | Currently unused; needs attribute definitions                                                                                                  |
| `server/data/positions.json`          | **UPDATE**                    | Shinheuh becomes two codes sharing a combat slot (see design note below)                                                                       |
| `new: data/cards/schema.json`         | **CREATE**                    | JSON Schema for YAML validation                                                                                                                |
| `new: scripts/compile-cards.js`       | **CREATE**                    | Compiles YAML → `server/data/cards.json`                                                                                                       |

### Design Note: Shinheuh Position Model

Shinheuh is unique among positions — it has no fixed line. A shinheuh unit can be frontline or backline depending on the card. The data model handles this by splitting shinheuh into **two position codes** that share a single combat slot:

```json
{
  "frontline-shinheuh": {
    "name": "Frontline Shinheuh",
    "description": "A shinheuh summoned to the frontline",
    "line": "frontline",
    "special": true,
    "combatSlotGroup": "shinheuh"
  },
  "backline-shinheuh": {
    "name": "Backline Shinheuh",
    "description": "A shinheuh summoned to the backline",
    "line": "backline",
    "special": true,
    "combatSlotGroup": "shinheuh"
  }
}
```

**Why two codes sharing a slot:**

- Each code maps to a fixed line (consistent with how all other positions work — fisherman always frontline, lightbearer always backline)
- `combatSlotGroup` ties them together: when an ability is used by a unit deployed in either shinheuh position, it consumes the single shared `shinheuh` combat slot
- The YAML validator already accepts `frontline shinheuh` and `backline shinheuh` as separate values — the compiler maps them to these codes
- The combat slot logic is generic: look up the unit's position code, get `combatSlotGroup`, check availability for that group. Non-slot-sharing positions have `combatSlotGroup` equal to their own code (unique slot)
- Scalable: future positions that share a slot (e.g., variant forms of an existing position) just point to the same `combatSlotGroup`

**UI note (Phase 6):** The player sees "Shinheuh" as one position type. The card's line (front/back) can be indicated by a different icon (e.g., shark for frontline, whale for backline) or by appending the line in the tooltip — implementer's choice.

### Data Integrity & Source of Truth

**The `server/data/*.json` files are likely outdated.** They were written when the game was first scaffolded and have not been kept in sync with the YAML card definitions or RULES.md.

**Source of truth rules:**

| For this                                                                              | Source of truth is     | What to do                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card data (stats, abilities, passives, traits, effects, etc.)                         | `docs/cards/*.yml`     | The compiler reads these YAML files and produces `server/data/cards.json`. Do NOT edit `cards.json` by hand.                                                                                                                                                                                                                                        |
| Game rules (positions, traits, conditions, keywords, ranks, attributes, affiliations) | `RULES.md`             | Cross-check every value in `server/data/*.json` against the Rules document. Remove anything that no longer exists, add anything that is missing, fix any discrepancies.                                                                                                                                                                             |
| Icons (position icons, trait icons, condition icons)                                  | `public/assets/icons/` | The directory must contain one `.png` file per position/trait/condition code. Newer traits and conditions added in RULES.md (e.g., Vengeful, Cursed) likely have no icon file yet. **Flag missing icons** in an `ICONS_TODO.md` file at `public/assets/icons/` so an artist can fill them in later. The compiler should warn on missing icon files. |

> ⚠️ **Do not trust existing data files.** Always verify against RULES.md before using them in any logic.

### New Card Schema (YAML + Compiled JSON)

**Card as stored in JSON must include:**

- `cardId` (numeric, stable index)
- `type`: `"unit"` | `"skill"` | `"equipment"`
- `name`, `sobriquet` (optional)
- `cost`, `hp` (unit only), `rank` (unit only)
- `positionCodes`: array of position codes (use kebab-case codes internally)
- `traitCodes`: array of trait codes → merged from yml trait `name` + optional numeric `value`
- `attributeCodes`: array — `"hwayeomsa"`, `"irregular"`, `"anima"`, `"silver-dwarf"`, `"red-witch"`, `"jeonsulsa"`, `"living-ignition-weapon"`
- `affiliationCodes`: array
- `abilityCodes`: array of ability code strings
- `passiveCodes`: array of passive ability code strings
- `evolveInto` (unit only): `{ trigger: {...}, cardId: number }` — what triggers evolution and which card it becomes. `null` if it doesn't evolve
- `igniteInto` (equipment only): `{ trigger: {...}, cardId: number }` — what triggers ignition and which card it becomes. `null` if it doesn't ignite
- `evolvedFrom` (computed, only on evolved cards): `cardId` — reverse link to the base card. Set by the compiler, not in YAML
- `ignitedFrom` (computed, only on ignited equipment): `cardId` — reverse link to the base equipment. Set by the compiler, not in YAML
- `requirements` (skill/equipment only): array of requirement descriptions (compiled from natural language — see below)
- `effects` (skill/equipment only): array of effect descriptions
- `deckConstraints`: array of deckbuilding constraint objects. Each constraint has a `type` and type-specific parameters. Examples:
  - `{ "type": "unreachable" }` — cannot be included in a deck during deckbuilding
  - `{ "type": "max_copies", "copies": 2, "require": { "title_contains": "Viole", "count": 5 } }` — hypothetical future constraint
  - Empty array `[]` means no constraints (card works normally in deckbuilding)

> **Design note — Evolution and ignition use the same shape for a reason:**
> Both are _transformations_ — a card replaces itself with another card when a trigger fires. The mechanics differ (evolution preserves HP/conditions, ignition returns equipment on bearer death), but the data shape is identical: `{ trigger: {...}, cardId: number }`. This symmetry makes the compiler, validator, and UI cross-reference logic reusable. The reverse links (`evolvedFrom`, `ignitedFrom`) are compiler-computed so the target card can answer "what am I the evolved/ignited form of?" without the base card needing to be loaded.
>
> Adding a new transformation type (e.g., fusion, ascension) in the future means adding one new field (e.g., `fuseInto`) with the same `{ trigger, cardId }` shape and its reverse link (`fusedFrom`). No schema migration needed.

> **Design note — Keywords and deckbuilding constraints are separate concepts:**
> Keywords (Charge, Cleanse, Compress, Create, Destroy, Quick, Reclaim, Silence, Slay, Spend, Unreachable, `<position>`) are purely **text abbreviations** that make card descriptions less verbose. They are consumed at compile time and expanded into their target context:
>
> - `Quick` and `<position>` → parsed into **per-ability/per-passive** flags during compilation
> - `Charge`, `Create`, `Reclaim`, etc. → expanded into **effect-level** structured objects
> - `Unreachable` → expanded into a **`deckConstraints`** entry (`{ "type": "unreachable" }`), NOT a card-level boolean
>
> The distinction matters: "Unreachable" is both a keyword (text shorthand) AND a deckbuilding constraint (game rule). These are orthogonal concepts. A future deckbuilding constraint might have no keyword at all (e.g., a complex multi-condition rule expressed in plain English). By using `deckConstraints` as an extensible array of typed objects, the schema can grow to support arbitrary new constraints without polluting the card-level field namespace.

### The "Scalable Complexity" Problem (Critical Design Decision)

The current system treats passives, abilities, effects, and requirements as plain strings in YAML, then looks them up in a hardcoded registry. This does NOT scale to the complexity visible in cards like:

- Evankhell: `"round end: all enemies with Burned 3+ die"` — conditional mass removal based on a stacked condition
- Baam (evolved): `"quick: spend 2: the next time you play Baang this turn, play it 4 more times"` — stateful memory of future plays
- Yeon Yihwa: `"units with burn 3+ can't target me"` — conditional targeting restriction
- Chang Blarode: `"ally team chang members have resilient"` — cross-unit passive buff based on affiliation
- Yuri Zahard: `"if i have an ally Guide, i have Taunt"` — conditional passive based on ally attributes
- Karaka: `"karaka's servants' abilities have Quick"` — cross-unit passive affecting a specific group

**Recommendation: Two-Layer Effect System**

**Layer 1 — Effect Registry (Simple Effects)**
For straightforward effects like "Create 1", "Deal 2 damage", "Give Burned", keep a registry of `EffectCode → EffectClass` as currently designed. Each effect class receives a parsed context object.

**Layer 2 — Effect DSL (Complex Effects)**
For complex effects that combine conditions, targets, and actions, use a structured effect object in the compiled JSON:

```json
{
  "effects": [
    { "type": "deal_damage", "target": "enemy", "amount": 7 },
    {
      "type": "give_condition",
      "target": "enemy",
      "condition": "rooted",
      "rounds": 1
    },
    {
      "type": "conditional",
      "if": { "condition_type": "has_ally", "ally_attribute": "guide" },
      "then": { "type": "grant_trait", "target": "self", "trait": "taunt" }
    }
  ]
}
```

The YAML entries remain human-readable strings. The compiler (`scripts/compile-cards.js`) parses them into structured JSON objects. The game engine interprets the structured objects.

This approach:

- Keeps YAML authoring simple (just write what the card does in English)
- Makes common effects machine-readable for validation and the generic game engine
- Is extensible — new effect patterns are added to the compiler once; all existing cards benefit

### Compiler Scope & Boundaries (What It Actually Does)

The compiler is **not** a general-purpose NLP engine. It's a pattern matcher with a finite, curated vocabulary drawn from RULES.md keywords, known condition/trait/attribute names, and common effect phrasing. Its job is to match what it can and gracefully pass through what it can't.

**Three-tier compilation model:**

| Tier                      | What it matches                                                                                      | What it outputs                                                                | Who executes it                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Compiled**              | Keyword shorthands + common patterns (e.g., `"create 1"`, `"deal 7 to an enemy"`, `"give me Taunt"`) | Structured effect object: `{ type: "create_lighthouse", amount: 1 }`           | **Generic effect runner** — no per-card code needed                                                              |
| **Custom (pass-through)** | Unique one-off effects (e.g., `"the next time you play Baang this turn, play it 4 more times"`)      | Raw reference: `{ type: "custom", raw: "...", handler: "BaamEvolvedAbility" }` | **Specific handler class** — dev writes one class per unique mechanic                                            |
| **Future**                | Effects using mechanics not yet invented                                                             | Same as Custom — passes through as raw text                                    | Dev writes a handler class for the new mechanic; optionally adds a compiler pattern so future cards auto-compile |

**The key rule: the compiler never blocks a card.** If it can't match an effect string, it wraps it as a `custom` reference and the card still works — it just uses a hand-written handler instead of the generic runner.

**What makes a pattern "compilable"?**
A pattern is compilable if it uses only:

- A known action verb (deal, give, create, heal, draw, spend, destroy, grant, etc.)
- A known target (enemy, ally, self, all enemies, etc.)
- A known noun from the rules (trait names, condition names, position names, attribute names)
- Numeric values and simple quantifiers

Examples of compilable effects by category:

```
Compound:    "deal 7 to an enemy and give them Rooted"
Conditional: "if i have an ally Guide, i have Taunt"
Cost:        "spend 1: give Rooted to 2 enemies"
Keyword:     "create 1", "Quick", "give an enemy Doomed"
```

Examples that are NOT compilable (require custom handlers):

```
"the next time you play Baang this turn, play it 4 more times"
"karaka's servants' abilities have Quick"
"units with burn 3+ can't target me"
"when an ally gives Burned x to an enemy, they give Burned x+1 instead"
```

**Updating the compiler:** When a new card introduces a novel effect pattern, the dev has two choices:

1. **Write a custom handler class** for that card (always works, no compiler change needed)
2. **Add a compiler pattern** so the generic engine can handle it (beneficial if the pattern is likely to be reused)

Most effects in the current 60-card set fall into Tier 1 (compilable) because they use the constrained vocabulary of RULES.md keywords. The cards that need custom handlers (floor_of_death, chang_blarode, yeon_yihwa, karaka, evankhell's passive, baam evolved's ability) are the ones identified in the "Scalable Complexity" examples above — roughly 6-8 cards out of 60.

### Update Steps Phase 0

After completing each step below, mark it done in the Phase 0 Tracker above and update the **Progress Tracker** at the top of this file.

1. Create `data/cards/` directory — move all YAML files from `docs/cards/`
2. Create `data/cards/schema.json` — JSON Schema definition for the YAML structure (more strict than the current validator)
3. Rewrite `scripts/validate-cards.js` → `scripts/card-validate.js` — validate YAML against schema; keep filename→name validation; add checks for evolution consistency (evolved card exists), ignition consistency, cost-vs-rank ranges
4. Rewrite `scripts/create-card.js` → `scripts/card-create.js` — same basic template functionality, new location
5. Rewrite `scripts/lookup-cards.js` → `scripts/card-lookup.js` — same functionality
6. Create `scripts/compile-cards.js` — compiles all YAML files into `server/data/cards.json` with the new schema. Matches effect/ability/passive strings against known patterns (keywords, common effect phrasing) and outputs structured objects where possible; passes unmatched strings through as `custom` references. Computes cross-references (`evolveInto` ↔ `evolvedFrom`, `igniteInto` ↔ `ignitedFrom`). Generates stable `cardId` integers.
7. Update `package.json` script paths
8. Update `server/data/cards.json` — now generated by the compiler, not manually edited
9. Add `npm run compile:cards` script to package.json
10. Test: run compilation + validation, verify all 60+ cards produce valid output
11. Create `server/data/conditions.json` — all 11 conditions from RULES.md modeled as standalone entries (code, name, description, color category). Do NOT merge them into traits.json. Use the same structure pattern as affiliations.json.
12. Cross-check every `server/data/*.json` file against RULES.md: remove stale fields, add missing ones, fix discrepancies. This includes positions (verify frontline/backline/special), traits (all 16), conditions (all 11), affiliations (all 38), and attributes (all 7).
13. Create `public/assets/icons/ICONS_TODO.md` listing every trait and condition that is missing its `.png` icon file. The compiler should also emit warnings for missing icons during compilation.
14. Create `server/data/conditions.json` — all 11 conditions from RULES.md modeled as standalone entries (code, name, description, color category, iconPath). Do NOT embed them in traits.json.
15. Cross-check every `server/data/*.json` file against RULES.md: remove stale fields, add missing ones, fix discrepancies. This includes positions (verify frontline/backline/special), traits (all 16), conditions (all 11), affiliations (all 38), and attributes (all 7).
16. Create `public/assets/icons/ICONS_TODO.md` listing every trait and condition that is missing its `.png` icon file. The compiler should also emit warnings for missing icons.

**Verification for Phase 0**

When all steps above are done, confirm all checks pass, then mark Phase 0 as ✅ DONE in the **Progress Tracker** at the top of this file.

- `npm run compile:cards` succeeds with 0 errors
- `npm run validate:cards` (after rename) succeeds with 0 errors
- `server/data/cards.json` contains all 60+ cards with correct new schema
- Evolution is bidirectional: base card's `evolveInto.cardId` points to a valid card, and that card's `evolvedFrom` points back (e.g., karaka ↔ karaka_evolved)
- Ignition is bidirectional: base equipment's `igniteInto.cardId` points to a valid card, and that card's `ignitedFrom` points back (e.g., narumada ↔ narumada_ignited)
- All YAML tests pass (existing tests may need minor updates for new schema)

---

## Phase 1: EventBus Redesign

**Goal**: Make the event system support mutation-capable middleware pipeline for intent modification.

### Tracker

| #   | Step                            | Done? |
| --- | ------------------------------- | ----- |
| 1.0 | Rewrite EventBus.js             | [ ]   |
| 1.1 | Update Logger.js                | [ ]   |
| 1.2 | Update GameState.js constructor | [ ]   |
| 1.3 | Adapt existing subscribers      | [ ]   |
| 1.4 | Write EventBus tests            | [ ]   |
| —   | All existing tests pass         | [ ]   |

### Current Problems

- `publish()` is fire-and-forget — handlers cannot modify the payload
- `VALID_EVENTS` is a hardcoded list (brittle)
- No concept of event "phases" (before/during/after)
- No concept of event cancellation
- Event ordering is non-deterministic for dependent effects

### New Design

```
gameState.eventBus.emit("OnDealDamage", damagePayload)
   ↓
   [PRE phase — all handlers registered with priority < 0 run]
   → Barrier trait handler: mutates damagePayload.amount = 0
   → Resilient trait handler: mutates damagePayload.amount -= Resilient.value
   ↓
   [EXECUTE phase — the actual damage application]
   → GameState applies the (now-modified) damage
   ↓
   [POST phase — all handlers registered with priority > 0 run]
   → Logger records the event
   → "OnUnitDeath" check: if HP ≤ 0, emit OnUnitDeath
   ↓
   [RESOLVED phase — final handlers, cannot mutate]
   → UI broadcast notification
```

### Changes

| File                      | Action      | Notes                                                                                                                                                          |
| ------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/game/EventBus.js` | **REWRITE** | Priority system, 4 phases (PRE/EXECUTE/POST/RESOLVED), payload mutation during PRE phase, cancellation support, dynamic event names, no hardcoded VALID_EVENTS |
| `server/game/Logger.js`   | **UPDATE**  | Subscribe to POST/RESOLVED phases instead of all phases; remove circular reference handling (use structured clone instead)                                     |

### EventBus Interface

```js
class EventBus {
  emit(eventName, payload, options = { phase: 'execute' })
  // Returns: { modifiedPayload, cancelled: boolean }

  on(eventName, handler, options = { phase: 'execute', priority: 0 })
  // Returns: unsubscribe function

  once(eventName, handler, options = { phase: 'execute', priority: 0 })
  // Returns: unsubscribe function

  off(eventName, handler)

  // For effects that want to modify payloads before they take effect:
  // options.phase = 'pre', priority = negative number

  // For cleanup:
  removeAllListeners(eventName)
}
```

**Event Lifecycle:**

1. `Intent` phase — effect/passive declared intent (e.g., "I want to deal 3 damage to unit X")
2. `Pre-Apply` (PRE) phase — mutations allowed; traits/conditions can modify the payload (Barrier reduces damage to 0, Resilient reduces damage by 1, Weak increases damage by 1)
3. `Apply` (EXECUTE) phase — the actual game state mutation happens
4. `Post-Apply` (POST) phase — reactions, logging, condition triggers (e.g., "after dealing damage, if target died, trigger OnUnitDeath")
5. `Resolved` phase — final notifications, UI updates

### Update Steps Phase 1

After completing each step below, mark it done in the Phase 1 Tracker above and update the **Progress Tracker** at the top of this file.

1. Rewrite `EventBus.js` with priority-ordered handlers, phase support, payload mutation, and cancellation
2. Update `Logger.js` to use structuredClone and subscribe to appropriate phases
3. Update `GameState.js` constructor to create the new bus
4. Ensure existing subscribers (PassiveAbility subclasses, effects) work with the new API
5. Write tests for:
   - Basic pub/sub
   - Priority ordering
   - Payload mutation during PRE phase
   - Event cancellation
   - unsubscribeAll cleanup

**Verification for Phase 1**

When all steps above are done, confirm all checks pass, then mark Phase 1 as ✅ DONE in the **Progress Tracker** at the top of this file.

---

## Phase 2: GameState Rewrite

**Goal**: Complete, rules-compliant game state that supports all RULES.md mechanics.

This is the largest phase. It must be built incrementally, with tests after each sub-phase.

### Tracker

| #   | Sub-Phase                     | Done? |
| --- | ----------------------------- | ----- |
| 2A  | Core Loop (Round/Turn/Shinsu) | [ ]   |
| 2B  | Unit Deployment & Field       | [ ]   |
| 2C  | Card Types (Skill/Equipment)  | [ ]   |
| 2D  | Traits & Conditions           | [ ]   |
| 2E  | Attributes                    | [ ]   |

### Sub-Phase 2A: Core Loop (Round/Turn/Shinsu)

- RULES.md §3 (Gameplay) — setup, round structure, turn alternation, both-pass-ends-round
- RULES.md §2.1 (Shinsu) — reset each round, gain = round number, max 10 normal + 2 recharged, carryover logic
- RULES.md §2.2 (Lighthouses) — start 20, max 40, 0 = loss
- RULES.md §2.3 (Combat Slots) — flip up at round start, consume on ability use, reset at round end. Keyed by `combatSlotGroup` (position data field), not by position code. `frontline-shinheuh` and `backline-shinheuh` share the `"shinheuh"` slot.
- Deck management — 30 cards, no repeats, draw 5 initial + 1 per round, deck exhaustion = loss

### Sub-Phase 2B: Unit Deployment & Field

- RULES.md §5.1 (Units) — deploy from hand to position, must match one of card's positions. Shinheuh cards specify `frontline-shinheuh` or `backline-shinheuh` as their position code.
- RULES.md §2.4 (Combat Slots/Board) — 5-unit line max (frontline + backline), choose to destroy if full
- RULES.md §1.1-1.2 (Lines/Targeting) — can't target backline if frontline non-empty, can't target lighthouses if board non-empty
- RULES.md §5.3 (Landmarks, Special Positions) — only 1 landmark per player
- RULES.md §5.4 (Evolution) — trigger-based evolution triggered by `card.evolveInto.trigger`, evolves into card `card.evolveInto.cardId`. Preserve HP/conditions on evolve.
- RULES.md §6 (Keywords) — all keywords

### Sub-Phase 2C: Card Types

- Unit deployment (already partially in DeployUnitAction — needs overhaul)
- Skill cards — single-use, immediate effect, ends turn
- Equipment cards — attach to ally unit, 1 max per unit (Irregular exception), return to hand on bearer death
- Ignition — trigger-based equipment transformation

### Sub-Phase 2D: Traits & Conditions

- All 16 traits (Barrier, Bloodthirsty, Creator, Dealer, Immune, LastOneStanding, Lethal, Pierce, Reflect, Regenerate, Resilient, Ruthless, Sharpshooter, Strong, Taunt, Vengeful) — data from `server/data/traits.json`
- All 11 conditions (Burned, Cursed, Doomed, Exhausted, Frozen, Ghost, Heavy, Poisoned, Rooted, Stunned, Weak) — data from **`server/data/conditions.json`** (separate file, created in Phase 0)
- Stacking rules, duration (conditions end at round end)
- Trait/condition application, removal, and interaction with damage/ability pipeline

### Sub-Phase 2E: Attributes

- Anima: Shinheuh combat slot (slot group `"shinheuh"`, shared by `frontline-shinheuh` and `backline-shinheuh` positions), summon mechanics
- Guide/Silver Dwarf: card selection from deck on draw
- Guide/Red Witch: see opponent's hand + top deck cards
- Hwayeomsa: Fire Charge/Fire Core/Incinerate cycle
- Jeonsulsa: Conduit summoning, Jeonsul Baang random effects
- Irregular: Slay → Outsider Power granting
- Living Ignition Weapon: can hold multiple equipments

### File: `server/game/GameState.js` — Comprehensive Rewrite

```js
// New GameState structure (key additions vs current):
class GameState {
  constructor(roomCode, usernames) {
    this.eventBus = new EventBus(); // Phase 1 redesign
    this.actionRegistry = createActionRegistry();
    this.logger = new Logger(this.eventBus);

    this.roomCode = roomCode;
    this.usernames = usernames;
    this.round = 1;
    this.currentTurn = null; // set by setup
    this.roundEndOnTurnEnd = false;
    this.gameOver = false;
    this.winner = null;

    this.playerStates = {
      [usernames[0]]: this.#initPlayerState(usernames[0]),
      [usernames[1]]: this.#initPlayerState(usernames[1]),
    };

    // Combat slots — keyed by combatSlotGroup (position data field)
    // Most positions have their own unique group (e.g. "fisherman", "lightbearer"),
    // but shinheuh positions share group "shinheuh".
    // { "fisherman": true, "lightbearer": true, "spearbearer": true, "scout": true, "wavecontroller": true, "shinheuh": true }
    this.combatSlots = {};

    // Load all data files — including conditions.json (created in Phase 0)
    this.conditions = {}; // populated from server/data/conditions.json

    // Active effects (continuous effects applied to the game)
    this.activeEffects = [];

    this.#setupGame();
  }
}
```

### GameState Method Inventory (complete)

| Method                        | Exists | Needs Change                                                                                                                        |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `constructor`                 | ✅     | **Rewrite**: add combatSlots (keyed by `combatSlotGroup`), load conditions.json, fix shinsu init (1 shinsu at start per RULES)      |
| `#initializePlayerState`      | ✅     | **Update**: add conditions/traits maps to player, combat slots state (use `combatSlotGroup` from positions data), landmark tracking |
| `#draw`                       | ✅     | **Minor fix**: deck exhaustion = loss                                                                                               |
| `#filterYouState`             | ✅     | **Update**: add conditions, traits, attributes, combat slots (by group), shinheuh position indicators to client state               |
| `#filterOpponentState`        | ✅     | **Update**: add limited visibility (traits/conditions visible, hand hidden)                                                         |
| `getClientState`              | ✅     | **Minor**: may need extra fields                                                                                                    |
| `endTurn`                     | ✅     | **Verify**: rule about both-pass consecutive                                                                                        |
| `#endRound`                   | ✅     | **Update**: reset combat slots by group, trigger round-end effects (Regenerate, Burned, Cursed, Doomed), condition cleanup          |
| `getTotalShinsu`              | ✅     | **Keep**, verify correctness                                                                                                        |
| `#resetShinsu`                | ✅     | **Verify**: RULES says start with 1 shinsu per player at game start                                                                 |
| `spendShinsu`                 | ✅     | **Keep**                                                                                                                            |
| `#addEffect`                  | ✅     | **Update**: use new EventBus API                                                                                                    |
| `removeEffect`                | ✅     | **Keep**                                                                                                                            |
| `processAction`               | ✅     | **Keep** structure, expand action types                                                                                             |
| **NEW** `#setupGame`          | ❌     | Add round 1 start: 1 shinsu, draw 5, publish OnGameStart                                                                            |
| **NEW** `#onTurnStart`        | ❌     | Publish event, check game over                                                                                                      |
| **NEW** `#onTurnEnd`          | ❌     | Handle turn-end triggers (Burned damage)                                                                                            |
| **NEW** `#deployUnit`         | ❌     | Line cap enforcement, position selection (incl. `frontline-shinheuh`/`backline-shinheuh`), targeting setup                          |
| **NEW** `#playSkill`          | ❌     | Skill execution pipeline                                                                                                            |
| **NEW** `#equipEquipment`     | ❌     | Equipment attachment, ignition check                                                                                                |
| **NEW** `#evolveUnit`         | ❌     | Evolution mechanics — use `card.evolveInto` to find target card, preserve HP/conditions                                             |
| **NEW** `#switchPosition`     | ❌     | Position switching (shinheuh units can switch between `frontline-shinheuh` and `backline-shinheuh`)                                 |
| **NEW** `#destroyUnit`        | ❌     | Remove from field, trigger passives deactivation                                                                                    |
| **NEW** `#dealDamage`         | ❌     | Full damage pipeline: intent → pre-modify → apply → post-check → death                                                              |
| **NEW** `#applyCondition`     | ❌     | Condition application with stacking; pull condition definitions from `this.conditions` (loaded from conditions.json)                |
| **NEW** `#healUnit`           | ❌     | Healing mechanic                                                                                                                    |
| **NEW** `#checkWinCondition`  | ❌     | Lighthouse check, deck exhaustion check                                                                                             |
| **NEW** `#getTargetableUnits` | ❌     | Targeting logic per line visibility rules; account for shinheuh positions on both lines                                             |

**Completing Phase 2:** After each sub-phase (2A through 2E), mark it done in the tracker above and update the **Progress Tracker** at the top of this file. After all sub-phases are complete, mark Phase 2 as ✅ DONE.

### Tests for Phase 2

- NEW: `server/game/tests/GameState.core.test.js` — round management, turn alternation, shinsu math, draw/deck management
- NEW: `server/game/tests/GameState.combatSlots.test.js` — slot flip up/down, ability consumption, shared `combatSlotGroup` for shinheuh
- NEW: `server/game/tests/GameState.targeting.test.js` — line targeting rules, sharpshooter override, shinheuh on both lines
- NEW: `server/game/tests/GameState.traits.test.js` — each trait in isolation
- NEW: `server/game/tests/GameState.conditions.test.js` — each condition in isolation
- NEW: `server/game/tests/GameState.deploy.test.js` — deployment edge cases (line full, landmark unique, etc.)
- NEW: `server/game/tests/GameState.skills.test.js` — skill card execution
- NEW: `server/game/tests/GameState.equipment.test.js` — equipment attachment, ignition, removal

---

## Phase 3: Action System Overhaul

**Goal**: Complete action system supporting all player actions from RULES.md §3.2.

### Tracker

| #   | File                          | Done? |
| --- | ----------------------------- | ----- |
| 3.0 | DeployUnitAction (rewrite)    | [ ]   |
| 3.1 | UseAbilityAction (rewrite)    | [ ]   |
| 3.2 | PlaySkillAction (new)         | [ ]   |
| 3.3 | EquipEquipmentAction (new)    | [ ]   |
| 3.4 | SwitchPositionAction (new)    | [ ]   |
| 3.5 | PassTurnAction (minor update) | [ ]   |
| 3.6 | AddLighthousesAction (keep)   | [ ]   |
| 3.7 | Update actionRegistry.js      | [ ]   |
| 3.8 | Update ActionHandler.js       | [ ]   |

### Current Action Registry

```js
// Current actions:
"deploy-unit-action"; // DeployUnitAction — only handles units
"pass-turn-action"; // PassTurnAction — fine
"use-ability-action"; // UseAbilityAction — doesn't consume combat slots
"add-lighthouses-action"; // AddLighthousesAction — system-only, fine
```

### Required Actions

| Action            | Handler              | Source | Priority                                             |
| ----------------- | -------------------- | ------ | ---------------------------------------------------- |
| `deploy-unit`     | DeployUnitAction     | player | HIGH — rewrite to handle all 3 card types            |
| `use-ability`     | UseAbilityAction     | player | HIGH — add combat slot consumption, proper targeting |
| `pass-turn`       | PassTurnAction       | player | LOW — minor adjustments needed                       |
| `play-skill`      | PlaySkillAction      | player | HIGH — new action for skill cards                    |
| `equip-equipment` | EquipEquipmentAction | player | HIGH — new action for equipment cards                |
| `switch-position` | SwitchPositionAction | player | MEDIUM — new action                                  |
| `add-lighthouses` | AddLighthousesAction | system | LOW — fine as-is                                     |

### UseAbilityAction Rewrite

- Must consume the combat slot for the unit's position group — look up `positions[unit.placedPositionCode].combatSlotGroup` to find which slot to consume, not the position code directly
- Must validate targeting rules (unit can target what it's trying to target)
- Must validate cost payment (shinsu cost from ability text like "spend 1:")
- Must support target selection (single enemy, multiple enemies, ally, any)
- Must route to the ability's execute() with full context

### New Actions Detail

**PlaySkillAction** (new file: `server/game/actions/PlaySkillAction.js`)

```js
static schema = {
  source: "string",
  username: "string",
  handId: "number",
  targetInfo: "object?" // optional target
};
```

- Validate: card is `type: "skill"`, player has enough shinsu, requirements met
- Execute: spend shinsu, remove card from hand, execute effects, end turn. Skill's effect list may include compiled or custom effects (see Phase 0 compiler tiers).

**EquipEquipmentAction** (new file: `server/game/actions/EquipEquipmentAction.js`)

```js
static schema = {
  source: "string",
  username: "string",
  handId: "number",
  targetUnitId: "string"
};
```

- Validate: card is `type: "equipment"`, target is an ally unit on field, unit doesn't already have an equipment (unless Irregular), requirements met
- Execute: spend shinsu, remove card from hand, attach to unit, apply effects, check ignition trigger, end turn

**SwitchPositionAction** (new file: `server/game/actions/SwitchPositionAction.js`)

```js
static schema = {
  source: "string",
  username: "string",
  unitId: "string",
  newPositionCode: "string"
};
```

- Validate: unit belongs to player, unit on field, new position is valid for card (including switching between `frontline-shinheuh` and `backline-shinheuh`)
- Execute: move unit to different line if needed, update `placedPositionCode`. If line changes (front↔back), update the unit's position on the field accordingly.

### Update Steps Phase 3

After completing each file below, mark it done in the Phase 3 Tracker above and update the **Progress Tracker** at the top of this file.

| #   | File                                                  | Action                                                                 |
| --- | ----------------------------------------------------- | ---------------------------------------------------------------------- |
| 1   | `server/game/actions/DeployUnitAction.js`             | **REWRITE**: handle unit/skill/equipment routing or validate card type |
| 2   | `server/game/actions/UseAbilityAction.js`             | **REWRITE**: combat slot consumption, targeting, cost parsing          |
| 3   | `server/game/actions/PassTurnAction.js`               | **MINOR UPDATE**: verify compatibility with new GameState              |
| 4   | `server/game/actions/AddLighthousesAction.js`         | **KEEP** (minor lint)                                                  |
| 5   | **NEW** `server/game/actions/PlaySkillAction.js`      | **CREATE**                                                             |
| 6   | **NEW** `server/game/actions/EquipEquipmentAction.js` | **CREATE**                                                             |
| 7   | **NEW** `server/game/actions/SwitchPositionAction.js` | **CREATE**                                                             |
| 8   | `server/game/registries/actionRegistry.js`            | **UPDATE**: register new actions                                       |
| 9   | `server/game/ActionHandler.js`                        | **UPDATE** (minor): add target validation helper                       |

When all files above are complete, mark Phase 3 as ✅ DONE in the **Progress Tracker** at the top.

### Tests for Phase 3

- UPDATE: `server/game/tests/actions/DeployUnitAction.test.js` — expand for all card types
- UPDATE: `server/game/tests/actions/UseAbilityAction.test.js` — combat slots, targeting, costs
- NEW: `server/game/tests/actions/PlaySkillAction.test.js`
- NEW: `server/game/tests/actions/EquipEquipmentAction.test.js`
- NEW: `server/game/tests/actions/SwitchPositionAction.test.js`

---

## Phase 4: Ability & Passive System (Scalable Complexity)

**Goal**: Implement the two-layer effect system and all card abilities/passives.

### Tracker

| #   | File                                        | Done? |
| --- | ------------------------------------------- | ----- |
| 4.0 | Ability.js (update)                         | [ ]   |
| 4.1 | PassiveAbility.js (update)                  | [ ]   |
| 4.2 | CreateOneLighthouse (rewrite)               | [ ]   |
| 4.3 | DealDamageAbility (new)                     | [ ]   |
| 4.4 | Other ability classes (new)                 | [ ]   |
| 4.5 | Passive ability classes (new)               | [ ]   |
| 4.6 | abilityRegistry.js (update)                 | [ ]   |
| 4.7 | passiveAbilityRegistry.js (update + rename) | [ ]   |
| 4.8 | effectRegistry.js (new)                     | [ ]   |
| 4.9 | Effects: continuous/triggered (rewrite)     | [ ]   |

### Current Implementation

- `Ability.js` — abstract base with validate/execute/apply methods; `CreateOneLighthouse.js` is the only concrete ability
- `PassiveAbility.js` — abstract base with activate/deactivate/registerListeners; `RoundEndTakeOneDamage.js` is the only concrete passive
- `abilityRegistry.js` — maps code strings to Ability classes
- `passiveAbilityRegisttry.js` [sic] — maps code strings to PassiveAbility classes

### New Architecture

**Layer 1: Effect Definitions (`server/game/effects/`)**
Structured effect objects that can be composed. Each effect type is a class/function that takes parameters.

```js
// Effect types example:
// { type: "deal_damage", target: "enemy_unit|all_enemies|self", amount: 3 }
// { type: "give_condition", target: "enemy_unit", condition: "burned", value: 2 }
// { type: "create_lighthouse", amount: 1 }
// { type: "draw_card", amount: 1 }
// { type: "heal", target: "ally_unit", amount: 5 }
// { type: "grant_trait", target: "self|ally_units", trait: "taunt" }
// { type: "conditional", if: { ... }, then: [ effects ], else: [ effects ] }
// { type: "spend_shinsu", amount: 1, then: [ effects ] } // "spend X: do Y"
```

**Layer 2: Ability Registry**
Abilities are registered by code and contain one or more composed effects.

```js
// Ability classes become thin wrappers:
class DealDamageAbility extends Ability {
  constructor(amount) {
    super("deal-damage-7", "Deal 7 to an enemy", { amount });
  }
  // execute() returns structured effects array
  execute(context, gameState) {
    return [
      { type: "deal_damage", target: "enemy_unit", amount: this.params.amount },
    ];
  }
}
```

**The Compiler-GameEngine Contract**: The compiler categorizes each effect/passive/ability as either **compiled** (matched a known pattern → structured JSON) or **custom** (no match → `{ type: "custom", raw: "...", handler: "ClassName" }`). The game engine has two execution paths:

- **Generic effect runner**: handles compiled effects via a single interpreter that reads the structured JSON and dispatches to effect modules (`deal_damage`, `give_condition`, `create_lighthouse`, etc.). No per-card code needed.
- **Custom handler classes**: handle `custom` effects. The `handler` field names a registered Ability or PassiveAbility subclass that knows how to interpret its specific raw text. One class per unique mechanic.

See Phase 0 → "Compiler Scope & Boundaries" for the full breakdown of what is compilable vs. what needs a custom handler.

### Update Steps Phase 4

After completing each file below, mark it done in the Phase 4 Tracker above and update the **Progress Tracker** at the top of this file.

| #   | File                                                | Action                                                                       |
| --- | --------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | `server/game/Ability.js`                            | **UPDATE**: add effect execution pipeline, targeting helper, cost validation |
| 2   | `server/game/PassiveAbility.js`                     | **UPDATE**: use new EventBus API, add helper for conditional passives        |
| 3   | `server/game/abilities/CreateOneLighthouse.js`      | **REWRITE**: use new effect format                                           |
| 4   | **MANY NEW** `server/game/abilities/*.js`           | **CREATE**: one per unique ability pattern                                   |
| 5   | **MANY NEW** `server/game/passive_abilities/*.js`   | **CREATE**: one per unique passive pattern                                   |
| 6   | `server/game/registries/abilityRegistry.js`         | **UPDATE**: register all new abilities                                       |
| 7   | `server/game/registries/passiveAbilityRegisttry.js` | **UPDATE**: register all new passives, fix typo in filename                  |
| 8   | **NEW** `server/game/registries/effectRegistry.js`  | **CREATE**: restructured to support effect composition                       |
| 9   | `server/game/effects/continuous/`                   | **RETAIN** structure but rewrite content                                     |
| 10  | `server/game/effects/triggered/`                    | **RETAIN** structure but rewrite content                                     |

When all files above are complete, mark Phase 4 as ✅ DONE in the **Progress Tracker** at the top.

### Passive Complexity Examples (to test the system)

1. **Evankhell**: `"round end: all enemies with Burned 3+ die"` — needs condition value checking + conditional mass removal
2. **Chang Blarode**: `"ally team chang members have resilient"` — needs affiliation-based cross-unit buff, must track which units enter/leave after deployment
3. **Yuri Zahard**: `"if i have an ally Guide, i have Taunt"` — needs attribute-based conditional trait, dynamic (ally can be deployed/removed after)
4. **Yeon Yihwa**: `"units with burn 3+ can't target me"` — needs targeting restriction based on attacker's conditions
5. **Karaka**: `"karaka's servants' abilities have Quick"` — needs cross-unit effect based on specific affiliation name
6. **Floor of Death**: `"passives have no effect"` — needs blanket passive suppression (global effect); must also interact with its own `deckConstraints: [{ type: "unreachable" }]`
7. **Baam (evolved)**: `"quick: spend 2: the next time you play Baang this turn, play it 4 more times"` — needs stateful memory + future-event handling

### Tests for Phase 4

- NEW: `server/game/tests/abilities/*.test.js`
- UPDATE: `server/game/tests/passive_abilities/RoundEndTakeOneDamage.test.js`
- NEW: Integration tests for complex interactions (e.g., Barrier + multiple damage sources in one round)

---

## Phase 5: Testing Overhaul & Integration

**Goal**: Comprehensive test coverage for the entire game engine.

### Tracker

| #   | Area                                                       | Done? |
| --- | ---------------------------------------------------------- | ----- |
| 5.0 | Core (GameState, shinsu, deck, lighthouses, combat slots)  | [ ]   |
| 5.1 | Deploy (unit, skill, equipment, limits)                    | [ ]   |
| 5.2 | Combat (targeting, damage, traits, conditions, healing)    | [ ]   |
| 5.3 | Abilities (one per unique ability)                         | [ ]   |
| 5.4 | Passives (one per unique passive)                          | [ ]   |
| 5.5 | Evolution (Khun, Karaka, Baam)                             | [ ]   |
| 5.6 | Attributes (Hwayeomsa, Irregular, Jeonsulsa, Anima, Guide) | [ ]   |
| 5.7 | Effects (continuous, triggered)                            | [ ]   |
| 5.8 | Integration (full game flow, complex interactions)         | [ ]   |

### Test Structure

```
server/game/tests/
├── core/
│   ├── GameState.test.js           # INIT/constructor, round management, turn alternation
│   ├── GameState.shinsu.test.js    # Shinsu math, recharged, spending
│   ├── GameState.deck.test.js      # Draw, deck exhaustion=loss, init deck size
│   ├── GameState.lighthouses.test.js # Lighthouse management, win condition
│   └── GameState.combatSlots.test.js # Combat slot lifecycle
├── deploy/
│   ├── DeployUnit.test.js          # Unit deployment: positions, lines, cost
│   ├── DeploySkill.test.js         # Skill card execution
│   ├── EquipEquipment.test.js      # Equipment attachment, ignition
│   └── DeployLimits.test.js        # 5-per-line, landmark uniqueness, name uniqueness
├── combat/
│   ├── Targeting.test.js           # Line targeting rules, sharpshooter, ghost
│   ├── Damage.test.js              # Damage pipeline, death, pierce
│   ├── Traits.test.js              # Each trait in isolation
│   ├── Conditions.test.js          # Each condition in isolation (data from conditions.json)
│   └── Healing.test.js             # Healing mechanics
├── abilities/
│   ├── CreateOneLighthouse.test.js
│   └── (one per unique ability)
├── passives/
│   ├── RoundEndTakeOneDamage.test.js
│   └── (one per unique passive)
├── evolution/
│   ├── KhunEvolution.test.js       # Khun → Ice Spear → Khun (evolved)
│   ├── KarakaEvolution.test.js     # Karaka → any equipment → Karaka (evolved)
│   └── BaamEvolution.test.js       # Baam → Enryu's Thorn → Baam (evolved)
├── attributes/
│   ├── Hwayeomsa.test.js           # Fire Charge/Core/Incinerate cycle
│   ├── Irregular.test.js           # Slay → Outsider Powers
│   ├── Jeonsulsa.test.js           # Conduit + Jeonsul Baang
│   ├── Anima.test.js               # Shinheuh slot + summoning (verify combatSlotGroup sharing)
│   └── Guide.test.js               # Silver Dwarf / Red Witch mechanics
├── effects/
│   ├── ContinuousEffects.test.js   # Multi-round effects
│   └── TriggeredEffects.test.js    # One-shot triggered effects
├── integration/
│   ├── FullGameFlow.test.js        # Complete game from start to finish
│   └── ComplexInteractions.test.js # Multiple systems interacting
└── utils.js                        # Shared test utilities (keep, expand)
```

### Update Steps Phase 5

After completing each area below, mark it done in the Phase 5 Tracker above and update the **Progress Tracker** at the top of this file. When all test suites are passing, mark Phase 5 as ✅ DONE in the **Progress Tracker**.

### What to Test

- **Unit tests**: Each individual rule, trait, condition, ability in isolation
- **Integration tests**: Combined scenarios with multiple systems interacting
- **Edge cases**: Line full + deploy, deck empty + draw, 0 lighthouse + take damage, etc.
- **Regression tests**: For each bug found

### Test Utilities (expand `utils.js`)

```js
export function createGame(customDeck = null, firstPlayer = null)
export function advanceToRound(game, round)
export function deployUnit(game, playerIndex, handId, positionCode)
export function passTurn(game, playerIndex)
export function addToHand(game, playerIndex, cardIds)
export function expectShinsu(state, normalSpent, normalAvailable, recharged)
export function expectLighthouses(state, amount)
export function expectField(state, frontlineLength, backlineLength)
export function expectUnitHp(unit, expectedHp)
export function expectUnitTraits(unit, traitNames)
export function expectUnitConditions(unit, conditionNames)
```

### Test Configuration

- `jest.config.mjs` — already set up; may need minor update for new test patterns
- `jest-html-reporters` — already configured for reports/
- Coverage thresholds can be added later

---

## Phase 6: WebSocket & Client Updates

**Goal**: Ensure frontend/server communication stays in sync with new game state.

### Tracker

| #   | File                                               | Done? |
| --- | -------------------------------------------------- | ----- |
| 6.0 | `server/game/websocket.js` (minor update)          | [ ]   |
| 6.1 | `public/pages/game/script.js` (update)             | [ ]   |
| 6.2 | `public/pages/game/styles.css` (update)            | [ ]   |
| 6.3 | `public/pages/game/index.html` (update)            | [ ]   |
| 6.4 | `public/utils/card-util.js` (update)               | [ ]   |
| 6.5 | `public/components/unit-card-vertical/` (update)   | [ ]   |
| 6.6 | `public/components/unit-card-horizontal/` (update) | [ ]   |
| 6.7 | End-to-end testing                                 | [ ]   |

### WebSocket Layer (`server/game/websocket.js`)

**Current state**: ~95% complete. Socket.io connection handling, room management, game initialization, event broadcasting, disconnect cleanup all work well. Minor changes needed:

- `activeGames` Map may need TTL/cleanup for abandoned games
- Error handling in `game-action` could be more graceful (currently crashes on validation error)
- The broadcast function re-fetches room sockets each time — acceptable for now

### Update Steps Phase 6

After completing each file below, mark it done in the Phase 6 Tracker above and update the **Progress Tracker** at the top of this file. When all files are done and end-to-end testing passes, mark Phase 6 as ✅ DONE in the **Progress Tracker**.

### Changes Summary

| File                                      | Action                                                                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `server/game/websocket.js`                | **MINOR UPDATE**: adapt to new GameState constructor signature, handle skill/equipment actions                                    |
| `public/pages/game/script.js`             | **UPDATE**: handle new card types in UI (skill cards, equipment cards display), display conditions/traits/attributes properly     |
| `public/pages/game/styles.css`            | **UPDATE**: may need styles for new elements                                                                                      |
| `public/pages/game/index.html`            | **UPDATE**: may need new UI elements for conditions display, combat slot indicators                                               |
| `public/utils/card-util.js`               | **UPDATE**: process new card data structure                                                                                       |
| `public/components/unit-card-vertical/`   | **UPDATE**: display extra info (conditions overlay as separate from traits, equipment indicator, position-specific shinheuh icon) |
| `public/components/unit-card-horizontal/` | **UPDATE**: display extra info (same)                                                                                             |
| `public/components/tooltip/`              | **KEEP** — fine as-is                                                                                                             |

---

## Implementation Order & Dependencies

```
Phase 0 (Data Pipeline) ──┐
                           ├── Phase 1 (EventBus) ── Phase 2 (GameState) ── Phase 3 (Actions) ── Phase 4 (Abilities/Passives)
                           │                            │                        │
                           └────────────────────────────┴────────────────────────┘
                                                                                     │
                                                                                     ▼
                                                                            Phase 5 (Testing)
                                                                                     │
                                                                                     ▼
                                                                            Phase 6 (Frontend)
```

**Dependencies:**

- Phase 0 must come first (new card data schema is needed by everything)
- Phase 1 and Phase 0 can partially overlap (EventBus doesn't depend on card data)
- Phase 2 depends on Phase 1 (new EventBus) and Phase 0 (new card schema)
- Phase 3 depends on Phase 2 (GameState methods used by actions)
- Phase 4 depends on Phase 2 and Phase 3 (abilities are invoked by actions, interact with GameState)
- Phase 5 is ongoing throughout but gets final shape after Phase 4
- Phase 6 comes last (needs stable data structures from all previous phases)

**Suggested parallel work:**

- Phase 0 + Phase 1 can be done in parallel by different people
- Phase 2 sub-phases (A→E) must be sequential
- Test writing can begin as soon as each sub-phase's API stabilizes

---

## Files to Keep (No Changes Needed)

| File                            | Reason                                                                 |
| ------------------------------- | ---------------------------------------------------------------------- |
| `server/app.js`                 | Express setup, middleware, socket.io wiring — all correct              |
| `server/routes/router.js`       | Route aggregation — fine                                               |
| `server/routes/cards.js`        | REST endpoint for card data — may need minor schema update             |
| `server/routes/game.js`         | Room management — fine                                                 |
| `server/routes/play.js`         | Lobby/room creation — fine                                             |
| `server/routes/positions.js`    | Position data endpoint — fine                                          |
| `server/routes/affiliations.js` | Affiliation data endpoint — fine                                       |
| `server/routes/traits.js`       | Trait data endpoint — fine                                             |
| `server/routes/rules.js`        | Rules page route — fine                                                |
| `server/routes/auth.js`         | Auth/session handling — fine                                           |
| `server/utils/file-util.js`     | JSON file reading utility — fine                                       |
| `server/data/positions.json`    | **UPDATE** — shinheuh split into two codes with shared combatSlotGroup |
| `server/data/affiliations.json` | Affiliation data — fine                                                |
| `server/data/traits.json`       | Trait data only — verify against RULES.md                              |
| `server/data/conditions.json`   | **NEW** — created in Phase 0                                           |
| `public/index.html`             | Landing page — fine                                                    |
| `public/index.css`              | Landing page styles — fine                                             |
| `public/index.js`               | Landing page logic — fine                                              |
| `public/global.css`             | Global styles — fine                                                   |
| `public/components/navbar/`     | Navigation bar component — fine                                        |
| `public/components/tooltip/`    | Tooltip component — fine                                               |
| `public/assets/`                | Static assets — fine (no changes needed, may need additions)           |
| `jest.config.mjs`               | Jest configuration — fine                                              |
| `nodemon.json`                  | Dev server config — fine                                               |
| `.env`                          | Environment variables — fine                                           |
| `.gitignore`                    | Git ignore — fine                                                      |

## Files to Delete (No Longer Needed)

| File                                                                     | Reason                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `server/data/cards.json`                                                 | Will be regenerated by compiler; keep during transition, delete after Phase 0 complete |
| `server/game/effects/continuous/TestConsoleLogOnTurnEndUntilRoundEnd.js` | Test effect, replace with real effects                                                 |
| `server/game/effects/triggered/TestConsoleLogOnTurnEnd.js`               | Test effect, replace with real effects                                                 |

## Files to Rename

| Old Name                                            | New Name                                           | Reason                         |
| --------------------------------------------------- | -------------------------------------------------- | ------------------------------ |
| `server/game/registries/passiveAbilityRegisttry.js` | `server/game/registries/passiveAbilityRegistry.js` | Fix typo                       |
| `docs/scripts/create_card.js`                       | `scripts/card-create.js`                           | Move from docs to project root |
| `docs/scripts/validate_cards.js`                    | `scripts/card-validate.js`                         | Same                           |
| `docs/scripts/lookup_cards.js`                      | `scripts/card-lookup.js`                           | Same                           |

## Risks & Mitigations

| Risk                                                   | Likelihood | Mitigation                                                                          |
| ------------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------- |
| Card YAML→JSON compilation is lossy or incomplete      | Medium     | Design compiler to preserve raw text as fallback; validate both directions          |
| Effect DSL becomes too complex to maintain             | Medium     | Start simple, add effect types incrementally; favor composition over inheritance    |
| Game state becomes too large to serialize for frontend | Low        | Use selective serialization (sanitized objects), avoid sending full game state      |
| Passive interactions create infinite loops             | Medium     | Add execution depth limit to EventBus; add cycle detection                          |
| Frontend falls behind backend changes                  | Medium     | Keep frontend minimal during engine rewrite; update it in Phase 6 as a focused pass |

## Success Criteria

After all phases:

1. `npm test` passes with comprehensive coverage
2. `npm run dev` starts the server without errors
3. Two browser tabs can play a game through multiple rounds
4. All card types work: units, skills, equipment (including ignition)
5. All traits and conditions function correctly
6. At least 2 attribute systems work (recommended: Irregular + Hwayeomsa as they have the most complete card support)
7. Evolution works (Khun → Ice Spear → Khun (evolved) as the simplest test case)
8. Targeting rules work (frontline/backline/lighthouse)
9. The game ends correctly (lighthouse depletion or deck exhaustion)
