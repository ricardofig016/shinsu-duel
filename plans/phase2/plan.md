## Plan: Phase 2 — Authoritative GameState & Runtime Engine

**TL;DR:** Rewrite GameState.js into a rules-complete engine that handles all game state, lifecycle, transformations, attribute mechanics, and event-driven interactions. Build outward from compiler contracts → runtime subscriptions → authoritative zone/lifecycle services → attribute engines → integrated GameState. 10 phases, ~25 new files, ~120+ new tests.

---

### Phase 0: Compiler-Time Trigger Contracts

- Define typed trigger ASTs (`equip`, `slay`, `deploy`, `damage`, `kill`) in compiler
- Parse all raw trigger text at compile time — unsupported triggers **fail compilation** until modeled
- Update `compiled-cards.schema.json` with trigger shapes
- Create 5 new YAML cards: `fire_core.yml`, `incinerate_i.yml` through `incinerate_iv.yml` (unreachable)
- Recompile all cards
- **Note:** Unresolved effects compile as `type: "custom"` and are silently skipped at runtime with a logged warning. This is intentional for forward compatibility — new structured types are added to the compiler as their handlers are implemented.

### Phase 1: Foundational Services _(parallel sub-steps)_

- **IdFactory** — deterministic `Unit#<cardId>`, `Equip#<cardId>`, etc. (replaces `Math.random()`)
- **TargetResolver** — canonical targeting with frontline blocking, taunt, condition filters
- **EffectResolver** — recursive DSL resolution for nested `spend_shinsu`/`grant_ability`
- **Unit.js & Card.js** — switch to IdFactory instance IDs

### Phase 2: Missing Handler Implementations _(parallel)_

- `ChargeShinsuHandler` — add shinsu to normal pool (capped at round max)
- `CompressShinsuHandler` — reduce card cost
- `ReclaimCardsHandler` — move cards from discard to hand
- `GrantAbilityHandler` — register inner ability as active on bearer, cleanup on source removal

### Phase 3: Authoritative GameState Rewrite _(core, sequential)_

- **Zone data structures** — typed `deck`, `hand`, `discard`, `field`, `lighthouses`, `shinsu`, `combatSlots`, `shinheuhSlot`, `compressAmount`, `fireCharges`
- **ShinsuService** — extract shinsu logic with round cap and recharged pool rules
- **ZoneService** — sole card movement path; `draw` enforces deck exhaustion, while unreachable-card legality is enforced at deck construction (runtime-generated unreachable cards may enter and draw normally)
- **LifecycleEngine** — `deployUnit`, `destroyUnit`, `transformUnit`, `attach/detachEquipment`
- **Standardize event names** — `OnTurnEnd` → `turn:ended`, create `EventCatalog.js` with constants
- Rewrite GameState.js as thin orchestrator over services

### Phase 4: Trigger Manager & Evolution/Ignition _(depends on Phase 0+3)_

- **TriggerManager** — maps typed ASTs to event subscriptions, calls `LifecycleEngine.transformUnit`
- Wired into `deployUnit` (evolution) and `attachEquipment` (ignition)
- Mandatory immediate transform after triggering event's post phase
- Equipment de-ignition on bearer death/unequip

### Phase 5: Attribute Engines — Anima & Hwayeomsa _(depends on Phase 3+4)_

- **AnimaEngine** — round start Shinheuh slot creation, slot lifecycle tracking
- **HwayeomsaEngine** — Fire Charge accumulation, Fire Core/Incinerate generation
- **AttributeRegistry** — pluggable pattern for future attributes (Jeonsulsa, Irregular, etc.)

### Phase 6: Rules, Conditions & Traits Enforcement

- Condition cleanup on round end (`modifierStack.removeWhere`)
- Barrier reset on round start
- Combat slot management (spent/available, reset on round start, Free/Quick bypass)
- Deck constraint enforcement (unreachable cards)
- Card requirements validation (before cost deduction)
- Game-over detection (0 lighthouses, empty deck draw)
- Line overflow (5 max, overflow destroy)

### Phase 7: Targeting & Combat Rules

- Integrate TargetResolver into all 8+ handlers
- Enforce line targeting (frontline blocks backline, taunt, ghost, sharpshooter)
- Pending-decision protocol for multi-target choices

### Phase 8: Project Integration & Cohesion

- Update websocket.js — pending-decision protocol, new state shape
- Update `Logger` — extended snapshot, deeper causation trees
- `AddLighthousesAction` — migrate to service (stop bypassing ModifierStack)
- Consistent event naming audit — zero PascalCase `On*` names remain
- Delete empty legacy directories (`abilities/`, `passive_abilities/`, `effects/`)

### Phase 9: Documentation _(parallel with Phase 8)_

- 4 new docs: `TRIGGER_SYSTEM_ARCHITECTURE.md`, `GAMESTATE_ARCHITECTURE.md`, `ATTRIBUTE_SYSTEM_ARCHITECTURE.md`, `TARGETING_ARCHITECTURE.md`
- Update 3 existing docs: COMPILED_CARD_DSL.md, HANDLER_SYSTEM_ARCHITECTURE.md, MODIFIER_STACK_ARCHITECTURE.md

### Phase 10: Testing & Validation

- ~120+ new unit tests across all new components
- ~20 integration tests (full round cycle, evolution chains, loss conditions, targeting)
- Determinism test (20 identical runs)
- Full legacy suite pass (179+ existing tests)

---

### Key Decisions

- **Trigger parsing at compile time**, runtime never touches raw text
- **Mandatory immediate transform** — evolution/ignition auto-fires, no opt-out
- **Pending-decision protocol** — typed `{ decisionId, type, candidates }` for choices
- **Service layer for all mutations** — GameState delegates, handlers never mutate directly
- **Anima + Hwayeomsa only** — Silver Dwarf, Red Witch, Jeonsulsa, Irregular, LIW deferred to Phase 4
- **EventCatalog constants** — no magic event strings anywhere

### Stress-Tested Against Absurd Future Interactions

- Triple-nested spend with conditional targeting
- Equipment → Evolution → Ignition chain through silence/unequip
- Mass destroy + 5 simultaneous on-death triggers
- Evolution during opponent's turn
- Nested pending-decisions
- Incinerate IV targeting through frontline

---

**Relevant files:** ~25 new files created, ~20 existing files modified, 3 empty legacy directories deleted.

Please review. I'm ready to refine based on your feedback or begin implementation on your approval.
