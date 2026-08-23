## Plan: Rules-complete card effect engine

**TL;DR** — The runtime handler architecture (`EffectResolver` + `HandlerRegistry` + `BaseHandler` validate/execute + target pre-resolution + pending-decision protocol + service-layer mutations + `ModifierStack`) is sound and will be kept. Phases A–F are complete: all 93 YAML cards are structured DSL (zero `custom`/`handler`, enforced by the landed `CardDataAudit` test), structured unit and card target resolution (including `random`/`choose`/`cost`/`lowest_hp` selection and the explicit `series` grouping) is runtime-supported, `sequence`/`conditional` plus all seven predicates are wired, shared-target sequences (`targets` + `target: { link: sequence }`) resolve one target set across steps, the full effect-primitive catalog has handlers with tests, and the modifier system runtime (`modify_*`/`retain_equipment`/`modify_ability`) is wired end-to-end. The remaining work is runtime integration of grammar that already landed in the schemas/compiler (Phases G–J): global-rule runtime, Jeonsulsa mechanics, extended passive triggers, and rules-completeness enforcement.

**Steps**

_Phase A — DSL language & contracts_ (done)

Schema-validated structured grammar in both `card.schema.json` and `compiled-cards.schema.json`: effect nodes, modifier nodes, predicates, triggers, unit/card targets, keywords (`{code, raw}` objects), `deckConstraints` (with required `raw`), and card-level `series`. The extension batches (B4/B5/B6, the cards_to_add batch, and the audit corrections) added `filterValue` arrays (OR semantics), `traitNot`/`lowest_hp`/`shared_affiliation`/`has_passive`/`can_switch` filters, `grant_affiliation`, `return_to_hand`, `choose_position`, `play_jeonsul_baang`, `modify_repeat`, `retain_equipment`, `modify_cost`, `modify_condition`, `global_rule`, the `quick` marker node, and the extended trigger catalog.

_Phase B — Compiler revamp + full DSL migration_ (done)

All 93 cards compile with zero `custom`/`handler`; the compiled artifact is regenerated and checked in. `create_card`/Hwayeomsa (B6) was pulled forward. `CardDataAudit.test.js` asserts the zero-`custom`/zero-`handler` invariant against the checked-in `cards.json`. Compiler internals are exported and unit-tested.

_Phase C — Resolver structural nodes & predicates_ (done)

`sequence`/`conditional` resolve in `EffectResolver` (structural — no handler class); shared-target sequences (`targets` + `target: { link: sequence, count? }`) resolve one target set across steps with pending-decision continuations. `PredicateEvaluator` implements all seven predicates: `has_unit`, `alone_on_line`, `started_with_card`, `has_equipped`, `has_all_equipped`, `has_condition`, `has_equipment_count`. Trigger-less `conditional` passives re-evaluate via `PassiveManager` (always-on, revoke-safe, re-entrancy guarded). `GameState` records `startingDeck`; `startedWithCard` reads it.

_Phase D — Targeting extensions_ (done)

`TargetResolver` landed: `random`/`choose`/`cost`/`lowest_hp`/`traitNot` unit selection plus `shared_affiliation`/`has_passive`/`can_switch` filters; structured card targets (`resolveCardTargets` + `toCardTargetView`) wired through `EffectResolver` into `compress_shinsu`/`draw_card`/`reclaim_cards`/`create_card`; deck/hand/game sources; card decisions carry `cost`/`type`; `ZoneService.searchDeck`/`removeFromDiscard`; legacy `targetCardSelector` removed; `Card.rank` added. Card grouping is the explicit, schema-validated `series` field (`findCardsBySeries`), not a name heuristic — `findCardsByFamily` was removed.

_Phase E — New effect primitives_ (each: handler + service integration + validate/execute tests) _depends on C+D_ (done)

1. Lifecycle: `slay`, `transform`/revert (reuse `LifecycleEngine.killUnit`/`transformUnit`).
2. Zone movement: `summon`, `steal`, `discard`, `disarm`, `switch_position` (`create_card` landed in Phase B6).
3. Unit state: `remove_traits` (Silence), `copy_traits`, `grant_random_trait`, `peek_hand` (observer-only).
4. Abilities: `copy_ability` ("use an enemy ability"), `repeat_play` (delayed repeat + wildcard when `cardName` omitted).
5. Events: `card:discarded`, `unit:stolen`, `unit:silenced`, `hand:peeked`; audit points closed with `PhaseEHandlersIntegration.test.js`.

_Phase F — Modifier system runtime (always-on passives)_ _depends on C+D_ (done)

The modifier grammar and its **runtime are fully landed**: trigger-less `modify_*`/`retain_equipment` passives and equipment `effects` modifier nodes route through the always-on, revoke-safe, re-entrancy-guarded path (`PassiveManager` → `ModifierService`), predicate-gated via `PredicateEvaluator` (`if`), position-scoped (node-level `position` enforced at application), and suppressed by Disabled.

7. `ModifierStack`: `apply()` stores filter metadata (`when`/`source`/`victimFilter`/`blockedFilter`/`first`/`effect`/`cardType`/`affiliations`); consultation helpers `getDamageDealt`, `getHealModifier`, `getDamageTaken` (null-source-guarded), `getConditionAmplifier`, `getKeywords(unit,isFirst)`, `getTargetingRules`, `getRepeat`, `hasRetainEquipment`, `getAbilityAugments`, `matchesUnitFilter`.
8. `ModifierService` owns apply (`applyModifier` — all 8 modifier types) + revoke (`revokeBySource`) + `getEffectiveCost` (the single cost authority, wired into `PlaySkillAction`/`DeployUnitAction`/`EquipEquipmentAction` validate + execute). Consultation points consume the stack: damage/heal amplifiers, `damage_taken` with `source` filter, cost modifiers, Quick/Free + `first`-per-round, targeting restrictions, condition amplification, `modify_repeat`, and `modify_ability` augments (once per target per trigger).
9. Trigger wiring: `PassiveManager._parseTrigger` also handles `skill_played`/`deal_damage`/`quick_ability_used` (payload-threaded); `LifecycleEngine._resolveEquipmentEffects` dispatches modifier / effect / triggered-effect (`deal_damage`, `quick_ability_used`). Grammar: `attack` removed from both schemas + docs; `modify_ability` + `cardType` added; `ice_spear`/`lo_po_bia_ren` re-authored; `cards.json` regenerated (zero `custom`/`handler`). Migrates clusters B, F, V, I + the newer modifier cards (Edin Dan, Phobos, Beta, Karaka, etc.).
10. `retain_equipment` helper is registered but its consumer (`return_to_hand`) lands in Phase J — no behavior change yet.

_Phase G — Global rule modifiers (landmarks)_ _depends on C+D+E+F_ (reuses the Phase F always-on revoke/re-apply + position machinery)

11. `global_rule` grammar is landed (`disable_passives`, `grant_global_trait`, `grant_global_condition`, `condition_stack_cap`, `prevent_evolve`, `prevent_equip`; `position` scoping incl. the `chosen` sentinel). Remaining: `GlobalRuleRegistry` + hooks — `disable_passives` (suppress `PassiveManager`), `condition_stack_cap` (cap condition stacking), `prevent_evolve`/`prevent_equip` (gate `LifecycleEngine`), `grant_global_*` (position-scoped application, incl. `position: chosen`). NOTE: `global_rule` nodes are NOT in `ModifierService.isModifier`'s type set today, so trigger-less `global_rule` passives (Floor of Death, Water Stadium, Name Hunt Station) are currently skipped by `PassiveManager` — route them through `GlobalRuleRegistry` as source-tracked entries on the Phase F always-on path.
12. `choose_position` handler + stored landmark choice (Name Hunt Station) resolve the `chosen` sentinel. NOTE: Name Hunt Station's `choose_position` passive is `trigger: { type: deploy }` — pull the `deploy` trigger wiring forward from Phase I or the landmark choice never fires.
13. Migrates cluster N.

_Phase H — Jeonsulsa attribute engine_ _depends on E_

14. `play_jeonsul_baang` node is landed and Conduit's passives are migrated (`round_start_or_activation` trigger). Remaining: `JeonsulsaEngine` in `AttributeRegistry` — deploy mechanic ("heal 2 HP from or summon Conduit on the enemy backline"), Conduit lifecycle (round-start Ghost, self-slay when no enemy Jeonsulsa, "for every 2 HP play 1 random Jeonsul Baang on a random ally"), the Activation event backing `round_start_or_activation`, and the `play_jeonsul_baang` handler (seeded-random Lightning/Thunder/Static Baang on a random ally).
15. Migrates clusters P, Q.

_Phase I — Trigger/passive extension_ _depends on C+D+E_

16. `PassiveManager._parseTrigger` currently wires `round_start`/`round_end`/`skill_played`/`deal_damage`/`quick_ability_used` (Phase F) and silently skips the rest. Wire the remaining triggers used by compiled cards: `deploy` (pulled forward into Phase G for Name Hunt Station), `summon`, `draw`, `reclaim`, `equip` (unit passives), `dies`, `ally_dies`, `free_ability_played`, `evolve` — adding events where none exists (free-ability usage; the `quick` flag on `UNIT_ABILITY_USED` already landed in Phase F). `round_start_or_activation` is wired in Phase H (Activation event). `attack` was removed from the grammar in Phase F. Migrates the remaining passive clusters (X, Y, T).
17. `enemy_dies` stays in the grammar (unused; kept per user).

_Phase J — Rules-completeness enforcement + cleanup + docs_ _depends on all_

18. Complete the last effect primitives that currently skip via `EFFECT_UNSUPPORTED`: `grant_affiliation` (Michael), `return_to_hand` (Beta) — `choose_position` is handled in Phase G.
19. Remove the `custom` skip in `EffectResolver` (unknown types throw); repurpose `EFFECT_UNSUPPORTED` (retained only for `CreateCardHandler` `generated_by` resource skips); the `handler` field is already gone from the compiled contract (kept out by the audit test).
20. Per-cluster integration matrix (the zero-`custom` audit test is landed), full suite + determinism.
21. Docs updates (below), applied incrementally per phase.

**Relevant files**

- `EffectResolver.js` — structural nodes (done); register new handlers; remove skip (Phase J)
- `TargetResolver.js` — targeting restrictions (Phase F)
- `services/PassiveManager.js` — always-on modifiers (F) + full trigger mapping (I)
- `services/GlobalRuleRegistry.js` (new, Phase G); `services/LifecycleEngine.js`, `services/UnitService.js`, `services/ZoneService.js`, `services/PredicateEvaluator.js`
- `attributes/JeonsulsaEngine.js` (new, Phase H); `attributes/AttributeRegistry.js`
- `ModifierStack.js` — modifier vocabulary + consultation helpers (Phase F)
- `services/ModifierService.js` — `applyModifier`/`revokeBySource`/`getEffectiveCost` (Phase F)
- `EventCatalog.js`, `GameState.js` — new events (F/G/H/I); deck-history tracking (done)
- `handlers` — new `BaseHandler` subclasses (registered via `handlerRegistry`, key = DSL type)
- Tests: `handlers/`, `tests/integration/`, `tests/regression/`

**Docs updates** (per `docs_update.md` conventions, incremental): `MODIFIER_STACK_ARCHITECTURE.md` (Phase F), `ATTRIBUTE_SYSTEM_ARCHITECTURE.md` (Jeonsulsa, Phase H), `PASSIVE_SYSTEM_ARCHITECTURE.md` + `TRIGGER_SYSTEM_ARCHITECTURE.md` (Phase I), plus incremental updates to the docs already written for Phases B–E (`COMPILED_CARD_DSL.md`, `HANDLER_SYSTEM_ARCHITECTURE.md`, `TARGETING_ARCHITECTURE.md`, `SERVICE_LAYER_ARCHITECTURE.md`, `EVENT_BUS_ARCHITECTURE.md`). `RULES.md` is untouched — cards are made to match it.

**Verification**

1. Run focused Jest per phase and the full suite at the end via `npm run test` (the script wraps Jest with the required Node flags; bare `npx jest` breaks ESM).
2. At least one playthrough integration test per cluster (24).
3. Determinism/replay tests for new random/choice paths. Hwayeomsa/Incinerate integration is covered by the `create_card` handler (green).
4. `npm run validate:cards` + `npm run compile:cards` whenever grammar or cards change.

**Decisions**

- Structured DSL in YAML; text is display-only and never parsed; no dual paths (regex matcher removed).
- The registry is the single type→handler mapping; unknown types throw (Phase J).
- Always-on modifiers and global rules are source-tracked modifiers owned by their unit/landmark (revoke-safe, re-evaluated on the same event set as always-on conditionals).

**Further Considerations**

1. `given` (used only by Khun Ran's `evolveInto`, handled by `TriggerManager`) and `enemy_dies` (unused) stay in the grammar; no `PassiveManager` wiring needed.
2. Khun Ran's "heal 2 HP from or summon Conduit on the enemy backline" deploy mechanic is an attribute-engine concern (RULES.md §Jeonsulsa), not card YAML — confirm the engine owns it (Phase H).
