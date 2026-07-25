## Plan: Project Resurrection - Comprehensive Rebuild Plan

**TL;DR**: Multipronged, phased rewrite of the Shinsu Duel game engine. Keep the networking/web layer (~90%), replace the game logic layer (~80%). Plan spans 6 phases over multiple implementation sessions, ordered by dependency and risk.

---

## Phase 0: Foundation & Data Pipeline

**Goal**: Establish the correct data model and card compilation pipeline before touching any game logic.

### What Changes

| File                            | Action                        | Notes                                                                     |
| ------------------------------- | ----------------------------- | ------------------------------------------------------------------------- |
| `docs/cards/*.yml`              | **MOVE** → `data/cards/*.yml` | Source of truth stays YAML; move from docs/ to project root data/         |
| `docs/scripts/*.js`             | **MOVE** → `scripts/card-*`   | Move alongside; update package.json script paths                          |
| `server/data/cards.json`        | **REGENERATE**                | New schema with all RULES.md fields                                       |
| `server/data/positions.json`    | **KEEP**                      | Schema seems fine; may need small additions                               |
| `server/data/affiliations.json` | **KEEP**                      | Used for mapping codes to display data                                    |
| `server/data/traits.json`       | **EXPAND**                    | Add condition definitions alongside trait definitions                     |
| `server/data/attributes.json`   | **EXPAND**                    | Currently unused; needs attribute definitions                             |
| `server/data/positions.json`    | **MINOR ADD**                 | May need `shinheuh` split into `frontline shinheuh` / `backline shinheuh` |
| `new: data/cards/schema.json`   | **CREATE**                    | JSON Schema for YAML validation                                           |
| `new: scripts/compile-cards.js` | **CREATE**                    | Compiles YAML → `server/data/cards.json`                                  |

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
- `evolveTrigger` (unit only): object describing evolution trigger (or null)
- `requirements` (skill/equipment only): array of requirement descriptions (compiled from natural language — see below)
- `effects` (skill/equipment only): array of effect descriptions
- `ignitionTrigger` (equipment only): ignition trigger description or null
- `ignitionCardId`: if this card is the ignited form of another card (e.g., narumada_ignited → parent relationship)
- `relatedCardIds`: for evolution (base → evolved), ignition (base → ignited)
- `keywords`: computed list of RULES.md keyword tags (quick, unreachable, etc.) derived from effects text

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
- Makes card effects machine-readable for validation, UI rendering, and game logic
- Is extensible — new effect types are just new effect type entries in the compiler
- Allows the compiler to be the single source of truth for card parsing logic

### Update Steps Phase 0

1. Create `data/cards/` directory — move all YAML files from `docs/cards/`
2. Create `data/cards/schema.json` — JSON Schema definition for the YAML structure (more strict than the current validator)
3. Rewrite `scripts/validate-cards.js` → `scripts/card-validate.js` — validate YAML against schema; keep filename→name validation; add checks for evolution consistency (evolved card exists), ignition consistency, cost-vs-rank ranges
4. Rewrite `scripts/create-card.js` → `scripts/card-create.js` — same basic template functionality, new location
5. Rewrite `scripts/lookup-cards.js` → `scripts/card-lookup.js` — same functionality
6. Create `scripts/compile-cards.js` — compiles all YAML files into `server/data/cards.json` with the new schema; parses natural-language effect strings into structured objects where possible; computes cross-references (evolution pairs, ignition pairs); generates `cardId` integers
7. Update `package.json` script paths
8. Update `server/data/cards.json` — now generated by the compiler, not manually edited
9. Add `npm run compile:cards` script to package.json
10. Test: run compilation + validation, verify all 60+ cards produce valid output

**Verification for Phase 0**

- `npm run compile:cards` succeeds with 0 errors
- `npm run validate:cards` (after rename) succeeds with 0 errors
- `server/data/cards.json` contains all 60+ cards with correct new schema
- Evolution pairs are correctly cross-referenced (e.g., karaka ↔ karaka_evolved)
- Ignition pairs are correctly cross-referenced (e.g., narumada ↔ narumada_ignited)
- All YAML tests pass (existing tests may need minor updates for new schema)

---

## Phase 1: EventBus Redesign

**Goal**: Make the event system support mutation-capable middleware pipeline for intent modification.

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

- All existing tests pass
- New EventBus tests pass
- Logger records events correctly with the new phase system

---

## Phase 2: GameState Rewrite

**Goal**: Complete, rules-compliant game state that supports all RULES.md mechanics.

This is the largest phase. It must be built incrementally, with tests after each sub-phase.

### Sub-Phase 2A: Core Loop (Round/Turn/Shinsu)

- RULES.md §3 (Gameplay) — setup, round structure, turn alternation, both-pass-ends-round
- RULES.md §2.1 (Shinsu) — reset each round, gain = round number, max 10 normal + 2 recharged, carryover logic
- RULES.md §2.2 (Lighthouses) — start 20, max 40, 0 = loss
- RULES.md §2.3 (Combat Slots) — flip up at round start, consume on ability use, reset at round end
- Deck management — 30 cards, no repeats, draw 5 initial + 1 per round, deck exhaustion = loss

### Sub-Phase 2B: Unit Deployment & Field

- RULES.md §5.1 (Units) — deploy from hand to position, must match one of card's positions
- RULES.md §2.4 (Combat Slots/Board) — 5-unit line max (frontline + backline), choose to destroy if full
- RULES.md §1.1-1.2 (Lines/Targeting) — can't target backline if frontline non-empty, can't target lighthouses if board non-empty
- RULES.md §5.3 (Landmarks, Special Positions) — only 1 landmark per player
- RULES.md §5.4 (Evolution) — trigger-based evolution, preserve HP/conditions on evolve
- RULES.md §6 (Keywords) — all keywords

### Sub-Phase 2C: Card Types

- Unit deployment (already partially in DeployUnitAction — needs overhaul)
- Skill cards — single-use, immediate effect, ends turn
- Equipment cards — attach to ally unit, 1 max per unit (Irregular exception), return to hand on bearer death
- Ignition — trigger-based equipment transformation

### Sub-Phase 2D: Traits & Conditions

- All 16 traits (Barrier, Bloodthirsty, Creator, Dealer, Immune, LastOneStanding, Lethal, Pierce, Reflect, Regenerate, Resilient, Ruthless, Sharpshooter, Strong, Taunt, Vengeful)
- All 11 conditions (Burned, Cursed, Doomed, Exhausted, Frozen, Ghost, Heavy, Poisoned, Rooted, Stunned, Weak)
- Stacking rules, duration (conditions end at round end)
- Trait/condition application, removal, and interaction with damage/ability pipeline

### Sub-Phase 2E: Attributes

- Anima: Shinheuh combat slot, summon mechanics
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

    // Combat slots
    // { username: { fisherman: true, lightbearer: true, ... } }
    this.combatSlots = {};

    // Active effects (continuous effects applied to the game)
    this.activeEffects = [];

    this.#setupGame();
  }
}
```

### GameState Method Inventory (complete)

| Method                        | Exists | Needs Change                                                                                                      |
| ----------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------- |
| `constructor`                 | ✅     | **Rewrite**: add combatSlots, fix shinsu init (1 shinsu at start per RULES)                                       |
| `#initializePlayerState`      | ✅     | **Update**: add conditions/traits maps to player, combat slots state, landmark tracking                           |
| `#draw`                       | ✅     | **Minor fix**: deck exhaustion = loss                                                                             |
| `#filterYouState`             | ✅     | **Update**: add conditions, traits, attributes, combat slots to client state                                      |
| `#filterOpponentState`        | ✅     | **Update**: add limited visibility (traits/conditions visible, hand hidden)                                       |
| `getClientState`              | ✅     | **Minor**: may need extra fields                                                                                  |
| `endTurn`                     | ✅     | **Verify**: rule about both-pass consecutive                                                                      |
| `#endRound`                   | ✅     | **Update**: reset combat slots, trigger round-end effects (Regenerate, Burned, Cursed, Doomed), condition cleanup |
| `getTotalShinsu`              | ✅     | **Keep**, verify correctness                                                                                      |
| `#resetShinsu`                | ✅     | **Verify**: RULES says start with 1 shinsu per player at game start                                               |
| `spendShinsu`                 | ✅     | **Keep**                                                                                                          |
| `#addEffect`                  | ✅     | **Update**: use new EventBus API                                                                                  |
| `removeEffect`                | ✅     | **Keep**                                                                                                          |
| `processAction`               | ✅     | **Keep** structure, expand action types                                                                           |
| **NEW** `#setupGame`          | ❌     | Add round 1 start: 1 shinsu, draw 5, publish OnGameStart                                                          |
| **NEW** `#onTurnStart`        | ❌     | Publish event, check game over                                                                                    |
| **NEW** `#onTurnEnd`          | ❌     | Handle turn-end triggers (Burned damage)                                                                          |
| **NEW** `#deployUnit`         | ❌     | Line cap enforcement, position selection, targeting setup                                                         |
| **NEW** `#playSkill`          | ❌     | Skill execution pipeline                                                                                          |
| **NEW** `#equipEquipment`     | ❌     | Equipment attachment, ignition check                                                                              |
| **NEW** `#evolveUnit`         | ❌     | Evolution mechanics                                                                                               |
| **NEW** `#switchPosition`     | ❌     | Position switching                                                                                                |
| **NEW** `#destroyUnit`        | ❌     | Remove from field, trigger passives deactivation                                                                  |
| **NEW** `#dealDamage`         | ❌     | Full damage pipeline: intent → pre-modify → apply → post-check → death                                            |
| **NEW** `#applyCondition`     | ❌     | Condition application with stacking                                                                               |
| **NEW** `#healUnit`           | ❌     | Healing mechanic                                                                                                  |
| **NEW** `#checkWinCondition`  | ❌     | Lighthouse check, deck exhaustion check                                                                           |
| **NEW** `#getTargetableUnits` | ❌     | Targeting logic per line visibility rules                                                                         |

### Tests for Phase 2

- NEW: `server/game/tests/GameState.core.test.js` — round management, turn alternation, shinsu math, draw/deck management
- NEW: `server/game/tests/GameState.combatSlots.test.js` — slot flip up/down, ability consumption
- NEW: `server/game/tests/GameState.targeting.test.js` — line targeting rules, sharpshooter override
- NEW: `server/game/tests/GameState.traits.test.js` — each trait in isolation
- NEW: `server/game/tests/GameState.conditions.test.js` — each condition in isolation
- NEW: `server/game/tests/GameState.deploy.test.js` — deployment edge cases (line full, landmark unique, etc.)
- NEW: `server/game/tests/GameState.skills.test.js` — skill card execution
- NEW: `server/game/tests/GameState.equipment.test.js` — equipment attachment, ignition, removal

---

## Phase 3: Action System Overhaul

**Goal**: Complete action system supporting all player actions from RULES.md §3.2.

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

- Must consume the combat slot for the unit's position (flip to unavailable)
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
- Execute: spend shinsu, remove card from hand, execute effects, end turn

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

- Validate: unit belongs to player, unit on field, new position is valid for card
- Execute: move unit to different line if needed, update placedPositionCode

### File Changes Phase 3

| File                                                  | Action                                                                 |
| ----------------------------------------------------- | ---------------------------------------------------------------------- |
| `server/game/actions/DeployUnitAction.js`             | **REWRITE**: handle unit/skill/equipment routing or validate card type |
| `server/game/actions/UseAbilityAction.js`             | **REWRITE**: combat slot consumption, targeting, cost parsing          |
| `server/game/actions/PassTurnAction.js`               | **MINOR UPDATE**: verify compatibility with new GameState              |
| `server/game/actions/AddLighthousesAction.js`         | **KEEP** (minor lint)                                                  |
| **NEW** `server/game/actions/PlaySkillAction.js`      | **CREATE**                                                             |
| **NEW** `server/game/actions/EquipEquipmentAction.js` | **CREATE**                                                             |
| **NEW** `server/game/actions/SwitchPositionAction.js` | **CREATE**                                                             |
| `server/game/registries/actionRegistry.js`            | **UPDATE**: register new actions                                       |
| `server/game/ActionHandler.js`                        | **UPDATE** (minor): add target validation helper                       |

### Tests for Phase 3

- UPDATE: `server/game/tests/actions/DeployUnitAction.test.js` — expand for all card types
- UPDATE: `server/game/tests/actions/UseAbilityAction.test.js` — combat slots, targeting, costs
- NEW: `server/game/tests/actions/PlaySkillAction.test.js`
- NEW: `server/game/tests/actions/EquipEquipmentAction.test.js`
- NEW: `server/game/tests/actions/SwitchPositionAction.test.js`

---

## Phase 4: Ability & Passive System (Scalable Complexity)

**Goal**: Implement the two-layer effect system and all card abilities/passives.

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

**The Compiler Bridge**: `scripts/compile-cards.js` reads YAML ability/passive/effect strings and maps them to known structured effect objects. For complex cards that can't be fully machine-parsed, the effect text is preserved as a fallback string and the game engine handles it via a more specific handler.

### File Changes Phase 4

| File                                                | Action                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------- |
| `server/game/Ability.js`                            | **UPDATE**: add effect execution pipeline, targeting helper, cost validation |
| `server/game/PassiveAbility.js`                     | **UPDATE**: use new EventBus API, add helper for conditional passives        |
| `server/game/abilities/CreateOneLighthouse.js`      | **REWRITE**: use new effect format                                           |
| **MANY NEW** `server/game/abilities/*.js`           | **CREATE**: one per unique ability pattern                                   |
| **MANY NEW** `server/game/passive_abilities/*.js`   | **CREATE**: one per unique passive pattern                                   |
| `server/game/registries/abilityRegistry.js`         | **UPDATE**: register all new abilities                                       |
| `server/game/registries/passiveAbilityRegisttry.js` | **UPDATE**: register all new passives, fix typo in filename                  |
| **NEW** `server/game/registries/effectRegistry.js`  | **CREATE**: restructured to support effect composition                       |
| `server/game/effects/continuous/`                   | **RETAIN** structure but rewrite content                                     |
| `server/game/effects/triggered/`                    | **RETAIN** structure but rewrite content                                     |

### Passive Complexity Examples (to test the system)

1. **Evankhell**: `"round end: all enemies with Burned 3+ die"` — needs condition value checking + conditional mass removal
2. **Chang Blarode**: `"ally team chang members have resilient"` — needs affiliation-based cross-unit buff, must track which units enter/leave after deployment
3. **Yuri Zahard**: `"if i have an ally Guide, i have Taunt"` — needs attribute-based conditional trait, dynamic (ally can be deployed/removed after)
4. **Yeon Yihwa**: `"units with burn 3+ can't target me"` — needs targeting restriction based on attacker's conditions
5. **Karaka**: `"karaka's servants' abilities have Quick"` — needs cross-unit effect based on specific affiliation name
6. **Floor of Death**: `"passives have no effect"` — needs blanket passive suppression (global effect)
7. **Baam (evolved)**: `"quick: spend 2: the next time you play Baang this turn, play it 4 more times"` — needs stateful memory + future-event handling

### Tests for Phase 4

- NEW: `server/game/tests/abilities/*.test.js`
- UPDATE: `server/game/tests/passive_abilities/RoundEndTakeOneDamage.test.js`
- NEW: Integration tests for complex interactions (e.g., Barrier + multiple damage sources in one round)

---

## Phase 5: Testing Overhaul & Integration

**Goal**: Comprehensive test coverage for the entire game engine.

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
│   ├── Conditions.test.js          # Each condition in isolation
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
│   ├── Anima.test.js               # Shinheuh slot + summoning
│   └── Guide.test.js               # Silver Dwarf / Red Witch mechanics
├── effects/
│   ├── ContinuousEffects.test.js   # Multi-round effects
│   └── TriggeredEffects.test.js    # One-shot triggered effects
├── integration/
│   ├── FullGameFlow.test.js        # Complete game from start to finish
│   └── ComplexInteractions.test.js # Multiple systems interacting
└── utils.js                        # Shared test utilities (keep, expand)
```

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

### WebSocket Layer (`server/game/websocket.js`)

**Current state**: ~95% complete. Socket.io connection handling, room management, game initialization, event broadcasting, disconnect cleanup all work well. Minor changes needed:

- `activeGames` Map may need TTL/cleanup for abandoned games
- Error handling in `game-action` could be more graceful (currently crashes on validation error)
- The broadcast function re-fetches room sockets each time — acceptable for now

### Changes Summary

| File                                      | Action                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `server/game/websocket.js`                | **MINOR UPDATE**: adapt to new GameState constructor signature, handle skill/equipment actions                                |
| `public/pages/game/script.js`             | **UPDATE**: handle new card types in UI (skill cards, equipment cards display), display conditions/traits/attributes properly |
| `public/pages/game/styles.css`            | **UPDATE**: may need styles for new elements                                                                                  |
| `public/pages/game/index.html`            | **UPDATE**: may need new UI elements for conditions display, combat slot indicators                                           |
| `public/utils/card-util.js`               | **UPDATE**: process new card data structure                                                                                   |
| `public/components/unit-card-vertical/`   | **UPDATE**: display extra info (conditions overlay, equipment indicator)                                                      |
| `public/components/unit-card-horizontal/` | **UPDATE**: display extra info                                                                                                |
| `public/components/tooltip/`              | **KEEP** — fine as-is                                                                                                         |

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

| File                            | Reason                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| `server/app.js`                 | Express setup, middleware, socket.io wiring — all correct    |
| `server/routes/router.js`       | Route aggregation — fine                                     |
| `server/routes/cards.js`        | REST endpoint for card data — may need minor schema update   |
| `server/routes/game.js`         | Room management — fine                                       |
| `server/routes/play.js`         | Lobby/room creation — fine                                   |
| `server/routes/positions.js`    | Position data endpoint — fine                                |
| `server/routes/affiliations.js` | Affiliation data endpoint — fine                             |
| `server/routes/traits.js`       | Trait data endpoint — fine                                   |
| `server/routes/rules.js`        | Rules page route — fine                                      |
| `server/routes/auth.js`         | Auth/session handling — fine                                 |
| `server/utils/file-util.js`     | JSON file reading utility — fine                             |
| `server/data/positions.json`    | Position data — most content reusable                        |
| `server/data/affiliations.json` | Affiliation data — fine                                      |
| `server/data/traits.json`       | Trait data — may need minor expansion for conditions         |
| `public/index.html`             | Landing page — fine                                          |
| `public/index.css`              | Landing page styles — fine                                   |
| `public/index.js`               | Landing page logic — fine                                    |
| `public/global.css`             | Global styles — fine                                         |
| `public/components/navbar/`     | Navigation bar component — fine                              |
| `public/components/tooltip/`    | Tooltip component — fine                                     |
| `public/assets/`                | Static assets — fine (no changes needed, may need additions) |
| `jest.config.mjs`               | Jest configuration — fine                                    |
| `nodemon.json`                  | Dev server config — fine                                     |
| `.env`                          | Environment variables — fine                                 |
| `.gitignore`                    | Git ignore — fine                                            |

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
