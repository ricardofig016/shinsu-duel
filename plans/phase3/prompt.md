start by reading PROJECT_RESURRECTION_PLAN.md, RULES.md, and all the md files in docs/ before you do anything else, to understand the scope of the project.

youre job is to write a full plan for phase 3.

all phases up until this phase are completely implemented. carefully analyse everything implemented until now. pay special focus for agentic instructions, behaviour, and objectivies found in the source markdown files. if you have any questions while mapping out the plan, ask me for clarification. do not assume anything. treat RULES.md as the absolute source of truth for game rules. the only thing above it is me. ask me for clrification on anything you are unsure about.

maximize adn thrive for excelent, enterprise-level design and architecture, code cleanliness, maintainability, extensibility, and scalability. identify exactly what is the porpuse of this phase, how it ties together with the previous and following phases, and its role in the overall project and project resurrection. identify all the gaps, pitfalls, and features that need to be addressed in this phase. provide clear acceptance criteria for each task and subtask. ensure that the plan aligns with the overall project resurrection goals and objectives. the most important thing here that i need you to constantly keep in mind while planning out this phase is that we need to expect that the most unique and complex cards with the most unique and complex interactions will be added to the game in the future, and this phase needs to be designed to handle everything that any hypothetical game mechanic can throw at it. don't be too afraid to overengineer the architecture in the persuit of perfection.

take some time at the end of your reasoning to actually brainstorm the most absurd and complex interactions you can think of, and analyse how your architecture and design would handle them.

make sure that the implemented components are well encorporated into the existing project, and not just thrown in as an independent module. the implementation should feel like it fits in with the previous phases.

every component should be thoroughly tested and every major architecture component should be documented in docs/ in the style, structure, format, and vibe of the existing docs there.


I'll write an overview that captures the implemented work and focuses on the hidden pitfalls and context a next-phase planner needs. Let me first verify the current state of the key changed files so I don't repeat docs or state anything inaccurate.

Read changed files in [](file:///c%3A/Users/rfigueiredo/Desktop/personal/projects/shinsu-duel)

# Overview of Implemented Phases (for the Next-Phase Planner)

This is a bridge document for the architect of the **next** phase. It assumes you've read PROJECT_RESURRECTION_PLAN.md, RULES.md, and the 9 files in docs. The docs describe *what each component is and how it's used*; this overview focuses on **state, integration status, and hidden pitfalls** that the docs don't surface — the things most likely to trip up a planner.

## Where things stand

The resurrection plan runs **Phase 0 (compiler) → 1 (EventBus) → 2 (GameState/substrate) → 3 (Actions) → 4 (Effects/passives) → 5 (Integration) → 6 (WebSocket/client)**. Phases 0–2 are implemented. Your phase sits on top of Phase 2's authoritative state layer.

**Phase 2 delivered, on top of the Phase 1 substrate (GameClock / EventBus / ModifierStack / Logger / 9 baseline handlers):**

- **Compiler contract**: evolution/ignition triggers are now **typed ASTs** (`{ type: "equip", cardName, position? }`) emitted by card-compile.js via `parseTrigger()`. Runtime never parses raw trigger text; `evolveInto.triggers` / `igniteInto.triggers` are arrays. **Unrecognized trigger text fails compilation** until a pattern is added.
- **5 new unreachable cards**: `Fire Core` + `Incinerate I–IV` were added as YAML and recompiled to 71 cards.
- **IdFactory**: deterministic `Card#<id>#<seq>` / `Unit#<id>#<seq>` instance IDs and `Unit#/<Equip#/Ability#/Passive#/Skill#/Landmark#/System` source IDs. Replaced `Math.random`.
- **EventCatalog (EVT)**: canonical `namespace:subject:verb` names. Legacy PascalCase emitted alongside for compat in some paths.
- **TargetResolver**: sole authority for turning target descriptors + filters into validated unit lists (frontline-blocks-backline, taunt, ghost, sharpshooter, condition/rank/position/count filters).
- **EffectResolver**: recursive DSL→handler engine covering all 12 structured types, including nested `spend_shinsu`/`grant_ability`.
- **4 new handlers**: `ChargeShinsu`, `CompressShinsu`, `ReclaimCards`, `GrantAbility`.
- **Services**: `ShinsuService`, `ZoneService`, `LifecycleEngine`, `TriggerManager`, `RequirementValidator`.
- **Attributes**: `AttributeRegistry` + `AnimaEngine` (Shinheuh slots) + `HwayeomsaEngine` (Fire Charge/Incinerate).
- **GameState** rewired: zone model (deck/hand/discard/field, combatSlots, shinheuhSlot, compressAmount, fireCharges), barrier reset on round start, condition cleanup on round end, `modifyLighthouses` with game-over detection, `gameOver`, `resolveDecision` (stub), snapshot extended with traits/conditions/equipment/charges.
- **Actions**: `DeployUnitAction` uses EVT; `UseAbilityAction` now validates **and consumes combat slots**; `AddLighthousesAction` now goes through `modifyLighthouses`.
- Websocket got game-over broadcasting + a `game-decision` socket (currently stubbed).
- Tests: **23 suites / 219 tests green**, `compile:cards` + `validate:cards` green.

---

## Hidden pitfalls & integration gaps (the critical non-obvious stuff)

These are the things the docs don't emphasize and that will bite your phase if you don't plan for them.

### 🔴 1. EffectResolver and RequirementValidator are DEAD CODE
- `EffectResolver` is defined and self-consistent, but **nothing imports or calls it**. GameState, handlers, and actions never invoke `resolveEffect`/`initEffectResolver`. Its nested-effect logic (recurse into `spend_shinsu.effect`) is never exercised.
- `RequirementValidator` is likewise **never called** anywhere. Card `requirements` strings ("deployed as Fisherman", "target is an ally") are currently **not enforced at play time**.
- **Implication for your phase**: any action that plays a card (skill/equipment/ability) is where these get wired. Do NOT assume "effect resolution is done" — it is *present but orphaned*. You must decide the entry point (likely a central "resolve a card's effects" path) and route all ability/effect execution through `EffectResolver`, and all skill/equipment requirements through `RequirementValidator` **before** cost deduction.

### 🔴 2. `LifecycleEngine.detachEquipment` has a broken line
```js
const Card = Card;  // self-assignment — a bug (L330)
```
This is meant to instantiate the de-ignited base-form card but collapses to `undefined`/shadowing. Equipment de-ignition on bearer death thus **does not currently produce a usable base card**. This lives inside `LifecycleEngine` which is otherwise not called by the action layer yet either — see next point.

### 🔴 3. LifecycleEngine / TriggerManager / AttributeRegistry are wired but the action layer doesn't use them
- `DeployUnitAction` still does its **own** hand-splice + `new Unit(...)` + direct field push + `spendShinsu`, **not** `LifecycleEngine.deployUnit`. So the rich deploy logic (line overflow, same-name check, landmark replacement, native-trait application, evolution-trigger registration, attribute `onUnitDeployed`) in `LifecycleEngine` is **never executed** in real play. Everything is unit-tested but effectively dormant.
- Consequence: evolution/ignition triggers registered inside `LifecycleEngine.deployUnit`/`attachEquipment` won't fire until actions route through it.
- **Implication**: your phase must migrate the existing `*Action` handlers onto the services. Migrating has real blast radius on existing ActionHandler tests — plan for it.

### 🔴 4. TargetResolver is integrated into only 3 of 9 handlers
`DealDamageHandler`, `GiveConditionHandler`, `HealHandler` accept a `target` descriptor + `sourceUnit` and route through `TargetResolver`. The other handlers (`GrantTrait`, `Cleanse`, `DestroyLighthouse`, etc.) still require a resolved `targetId`. Plan which handlers should accept descriptors and how target choice resolves for multi-target/count cases.

### 🟠 5. Combat slot consumption ignores **Free** and Shinheuh
`UseAbilityAction` consumes the slot unconditionally. RULES.md says **Free** abilities don't expend a combat slot, and Shinheuh abilities use the Anima-managed `shinheuhSlot` instead of the position slot. Neither nuance is modeled. Your phase needs to inspect the ability's `quick`/`free` metadata and the unit's position/type to decide what (if anything) is consumed.

### 🟠 6. Multi-target & choice resolution is stubbed
`GameState.resolveDecision()` only validates that a `decisionId` exists. The `pending-decision` protocol described in TARGETING_ARCHITECTURE.md (pause the engine, emit typed candidates, resume after player choice) is **not implemented**. Handlers currently resolve `count` by taking the first N targets (`targets.slice(0, count)` / `targets[0]`) — no player choice. Any card needing "choose 2 of your enemies" or overflow-destruction choice has no path yet. This is a likely centerpiece of your phase.

### 🟠 7. Event-name migration is INCOMPLETE
- `EVT` constants exist and most new code uses them.
- But Unit.js **duals**: the new kebab-case methods (`onSummon`→`unit:summoned`, `takeDamage`→`unit:damage:intent`) coexist with a direct `useAbility()` that emits `unit:ability:intent`/`unit:ability:resolved` — **neither of those two events is in `EVT`**, and no handler listens to them. Ability execution is effectively a no-op today.
- The `EVT` catalog has `RESOLVED`/`skill:applied`/`unit:ability:granted` constants but little emits them. Grep before you rely on any event name.

### 🟠 8. Deterministic-first-player chosen, but deck RNG still random
`GameState` uses username[0] as default first player (good for determinism), but `#getRandomCardId()` still uses `Math.random` when no deck is supplied, and `ZoneService.shuffleDeck` defaults to `Math.random`. If your phase introduces seeded RNG / replay, this is where it plugs in.

### 🟡 9. Attribute engines assume field reads, not lifecycle hooks
`AnimaEngine` subscribes to `"game:round:start"` (note: your docs list `game:round:start` but `EVT.ROUND_START = "round:started"` — **name mismatch**: AnimaEngine listens to one string, EVT defines another; verify which one actually fires). `HwayeomsaEngine`/`AnimaEngine` read the field directly at round start rather than being driven purely by lifecycle events — fine now, but brittle if field access patterns change. Also `_attributeRegistry.onUnitRemoved`/`cleanup` is **never called** on unit death, so Anima subscriptions can leak.

---

## What the docs "get right" that you should trust
- The full DSL type table (12 handler types + ~130 `custom`).
- Trigger AST shapes and the "unsupported = compile failure" rule.
- Rule enforcement table in GAMESTATE_ARCHITECTURE.md — this is your compliance checklist.
- EVENT_BUS_ARCHITECTURE.md phase ordering (pre/execute/post/resolved) and DFS semantics — **do not** build a parallel dispatch model; route through EventBus with `context.emitChild`.
- ModifierStack source-tracking semantics (unequip/silence/cleanse correctness) — keep all mutations on unit state through it.

---

## Suggested focus for your phase (tie-in)
Phase 3 in the plan is "Actions" — the natural next step. Given the audit above, the highest-value work is:
1. **Route the 4 existing actions through the Phase 2 services** (LifecycleEngine/ShinsuService/ZoneService) to activate the dormant rules, then
2. **Wire EffectResolver + RequirementValidator** into action execution (skills, equipment, abilities) so the 12 handler types and nested effects actually run, and
3. **Implement the pending-decision protocol** (choice/target selection) since multi-target cards are otherwise unplayable, and
4. **Fix the noted defects** (#2 `const Card = Card`, #4 Free/Shinheuh slot handling, #7 event-name gaps, #9 Anima event-name mismatch + cleanup leak).

This gives you a coherent phase that turns the (tested but inactive) Phase 2 substrate into a playable action system, exactly where the plan's Phase 3 boundary sits.

**Test baseline to preserve:** `npm test` = 23 suites / 219 passing; `npm run validate:cards` + `npm run compile:cards` = 71 cards green. Keep both intact as a regression floor.