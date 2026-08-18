## Plan: Rules-complete card effect engine

**TL;DR** — The runtime handler architecture (`EffectResolver` + `HandlerRegistry` + `BaseHandler` validate/execute + target pre-resolution + pending-decision protocol + service-layer mutations + `ModifierStack`) is sound and will be kept. Phases A–C are complete: all 82 YAML cards are structured DSL, the zero-`custom`/zero-`handler` artifact is landed, structured target resolution and the `create_card`/Hwayeomsa path are runtime-supported, and `sequence`/`conditional` plus all six predicates are wired. The remaining work is runtime integration (Phases D–J): targeting extensions, the remaining effect handlers, modifiers/global rules, Jeonsulsa mechanics, and richer passives/triggers.

**Steps**

_Phase A — DSL language & contracts_ (done)
_Phase B — Compiler revamp + full DSL migration_ (done) — artifact landed with zero `custom`/`handler`; structured target subset (B5a) and `create_card`/Hwayeomsa (B6) pulled forward.
_Phase C — Resolver structural nodes & predicates_ (done) — `sequence`/`conditional` resolve in `EffectResolver`; `PredicateEvaluator` implements all six predicates; trigger-less `conditional` passives re-evaluate via `PassiveManager`; `startedWithCard` records starting deck composition ("Ha Jinsung" has no card yet, so that predicate evaluates false).

_Phase D — Targeting extensions_ (done)

1. `TargetResolver`: `random`/`choose`/`cost` selection, deck/hand/game sources, extended card-target selectors. Landed: `random`/`choose`/`cost`/`lowest_hp`/`traitNot` unit selection; structured card targets (`resolveCardTargets` + `toCardTargetView`) wired through `EffectResolver` into `compress_shinsu`/`draw_card`/`reclaim_cards`/`create_card`; legacy `targetCardSelector` removed; `Card.rank` added; `findCardsByFamily` now matches trailing-numeral and leading-ordinal families (Thorn Fragments). The structured `{side, scope, count, filters}` subset (affiliation/attribute/name filters, array-OR rank/position) landed in Phase B5a.

_Phase E — New effect primitives_ (each: handler + service integration + validate/execute tests) _depends on C+D_

2. Lifecycle: `slay`, `transform`/revert (reuse `LifecycleEngine`).
3. Zone movement: `summon`, `steal`, `discard`, `disarm`, `switch_position` (`create_card` landed in Phase B6).
4. Unit state: `silence`, `remove_traits`, `copy_traits`, `grant_random_trait`, `peek_hand` (observer-only).
5. Abilities: `copy_ability` ("use an enemy ability"), delayed repeat-play.

_Phase F — Modifier system (always-on passives)_ _depends on C+D_

6. Extend `ModifierStack` vocabulary: damage/heal amplifiers, cost modifiers, "abilities have Quick", targeting restrictions ("ignore Taunt", "can't target me"), on-attack condition application ("attacks give Frozen").
7. Conditional modifiers gated by Phase C predicates; wire into damage math (`UnitService`), Quick handling, and action cost checks. Migrates clusters B, F, V, I.

_Phase G — Global rule modifiers (landmarks)_ _depends on C+D+E_

8. Global rule registry + hooks: "passives have no effect", "all Ranker units have Ghost", "conditions don't stack past 2", "cannot evolve, Rooted, cannot be equipped". Migrates cluster N.

_Phase H — Jeonsulsa attribute engine_ _depends on E_

9. `JeonsulsaEngine` in `AttributeRegistry`: Conduit, Jeonsul Baangs (Lightning/Thunder/Static), Activation, "for every 2 HP play 1 random Baang". Migrates clusters P, Q.

_Phase I — Trigger/passive extension_ _depends on C+D+E_

10. New trigger AST types (`summon`, `draw`, `free_ability_played`, `quick_ability_used`, `round_start_or_activation`); `PassiveManager` registers structured passives (removing the silent `custom` drop). Migrates remaining passive clusters.

_Phase J — Rules-completeness enforcement + cleanup + docs_ _depends on all_

11. Remove the `custom` skip in `EffectResolver` (unknown types throw); repurpose `EFFECT_UNSUPPORTED`; remove the `handler` field from the contract.
12. Per-cluster integration matrix (the zero-`custom` audit test is already landed), full suite + determinism.
13. Docs updates (below), applied incrementally per phase.

**Relevant files**

- `EffectResolver.js` — structural nodes (done); remove custom skip (Phase J)
- `TargetResolver.js` — `random`/`choice`/`cost` selection, deck/hand/game sources (Phase D)
- `handlers` — new `BaseHandler` subclasses (registered via `handlerRegistry`, key = DSL type)
- `services` — new `GlobalRuleRegistry`; extend `PassiveManager`, `TriggerManager`, `LifecycleEngine`, `UnitService`
- `ModifierStack.js` — modifier vocabulary + conditional gating
- `AttributeRegistry.js` — `JeonsulsaEngine`
- `EventCatalog.js`, `GameState.js` — new events; deck-history tracking (done)
- Tests: `handlers`, `tests/integration/`, `tests/regression/`

**Docs updates** (per `docs_update.md` conventions, incremental): `MODIFIER_STACK_ARCHITECTURE.md` (Phase F), `ATTRIBUTE_SYSTEM_ARCHITECTURE.md` (Jeonsulsa, Phase H), plus incremental updates to the docs already written for Phases B/C (`COMPILED_CARD_DSL.md`, `HANDLER_SYSTEM_ARCHITECTURE.md`, `TARGETING_ARCHITECTURE.md`, `PASSIVE_SYSTEM_ARCHITECTURE.md`, `TRIGGER_SYSTEM_ARCHITECTURE.md`, `SERVICE_LAYER_ARCHITECTURE.md`, `EVENT_BUS_ARCHITECTURE.md`). `RULES.md` is untouched — cards are made to match it.

**Verification**

1. Run focused Jest per phase and the full suite at the end via `npm run test` (the script wraps Jest with the required Node flags; bare `npx jest` breaks ESM).
2. At least one playthrough integration test per cluster (24).
3. Determinism/replay tests for new random/choice paths; coverage maintained (~97% stmts). Hwayeomsa/Incinerate integration is covered by the `create_card` handler (green).

**Decisions**

- Structured DSL in YAML; text is display-only and never parsed; no dual paths (regex matcher removed).
- The registry is the single type→handler mapping; unknown types throw (Phase J).

**Further Considerations**

1. Test placeholders `_test_Equipment`/`_test_Skill` — convert to structured no-op nodes in the allowlist, or remove from the production set.
2. Cluster T's "next time you play Baang this turn, play it 4 more times" needs a delayed/queued trigger — confirm in scope now or defer as a documented follow-up.
