## Plan: Rules-complete card effect engine

**TL;DR** — The runtime handler architecture (`EffectResolver` + `HandlerRegistry` + `BaseHandler` validate/execute + target pre-resolution + pending-decision protocol + service-layer mutations + `ModifierStack`) is sound and will be kept. The real gap: 123 of 181 compiled effects are `type: "custom"` and skipped at runtime because `card-compile.js` reverse-engineers card meaning from natural-language text with regex templates (`parseEffectText`), and anything unmatched falls through to `custom`. Per your decision, effects become **structured DSL authored directly in YAML** (`raw` = authored display-only text, never parsed), the compiler becomes a validating pass-through that fails loudly on unsupported structures, and the runtime grows: structural nodes (`sequence`, `conditional`), extended targeting, ~15 generic primitives, modifier-system extensions for always-on passives, a global-rule registry for landmark rules, a Jeonsulsa attribute engine, and richer passives/triggers. All 82 YAML files migrate cluster-by-cluster, interleaved with primitive implementation, and a completeness audit test enforces zero `custom` effects forever.

The 123 customs decompose into **24 semantic clusters** (verified against `cards.json`), from metadata (13 unreachable markers, quick flags, identity markers) to compound "deal + condition" chains, conditionals, affiliation/name/cost targeting, always-on stat amplifiers, global landmark rules, and Conduit/Jeonsulsa attribute mechanics.

**Steps**

_Phase A — DSL language & contracts (no runtime code)_ (done)

1. Define the source effect grammar: node types, fields; structural nodes `sequence` and `conditional`; target descriptor grammar (add name, affiliation, attribute, cost, random, choice, multi-owner, deck/hand sources); predicate grammar; modifier grammar.
2. Update `card-source.schema.json` (effect sub-schema — currently plain strings) and `compiled-cards.schema.json` (closed per-type DSL defs; remove `handler`; remove `additionalProperties: true`).
3. Commit the cluster inventory as the migration map artifact (working doc under `plans`), kept updated during migration.

_Phase B — Compiler revamp + metadata migration_

4. Rewrite `card-compile.js`: delete the regex matcher and `dslObject` custom fallback; validate/normalize structured nodes; fail-fast with descriptive errors; preserve `raw`. Update `card-validate.js` and `card-create.js`. _depends on 1_
5. Migrate metadata clusters: `unreachable` → `deckConstraints` only (removing the `handler: "UnreachableKeyword"` duplication), `quick` stays a node flag, identity markers → card data. _depends on 4_
6. Invariant: recompiled `cards.json` has zero `type: "custom"` for migrated cards. _depends on 5_

_Phase C — Resolver structural nodes & predicates_

7. `sequence` node in `EffectResolver.js` (recursive, reusing the pending-continuation deferral pattern). _depends on 4_
8. Predicate evaluator service + `conditional` node (if/then/otherwise) for board/deck-state checks ("if i have an allied Shinheuh", "alone on the frontline", "started the game with X"). _depends on 4_

_Phase D — Targeting extensions_ _(parallel with C)_

9. `TargetResolver`: name/affiliation/attribute/cost filters, seeded-random selection, choice decisions ("of your choice"), multi-owner targets ("both players' fields"), deck/hand sources, extended `resolveCardTarget` selectors.

_Phase E — New effect primitives_ (each: handler + service integration + validate/execute tests) _depends on C+D_

10. Lifecycle: `slay`, `transform`/revert (reuse `LifecycleEngine`).
11. Zone movement: `summon`, `create_card` (generalizes the Fire-Charge "create me" mechanic), `steal`, `discard`, `disarm`, `switch_position`.
12. Unit state: `silence`, `remove_traits`, `copy_traits`, `grant_random_trait`, `peek_hand` (observer-only).
13. Abilities: `copy_ability` ("use an enemy ability"), delayed repeat-play.

_Phase F — Modifier system (always-on passives)_ _depends on C+D_

14. Extend `ModifierStack` vocabulary: damage/heal amplifiers, cost modifiers, "abilities have Quick", targeting restrictions ("ignore Taunt", "can't target me"), on-attack condition application ("attacks give Frozen").
15. Conditional modifiers gated by Phase C predicates; wire into damage math (`UnitService`), Quick handling, and action cost checks. Migrates clusters B, F, V, I.

_Phase G — Global rule modifiers (landmarks)_ _depends on C+D+E_

16. Global rule registry + hooks: "passives have no effect", "all Ranker units have Ghost", "conditions don't stack past 2", "cannot evolve, Rooted, cannot be equipped". Migrates cluster N.

_Phase H — Jeonsulsa attribute engine_ _depends on E_

17. `JeonsulsaEngine` in `AttributeRegistry`: Conduit, Jeonsul Baangs (Lightning/Thunder/Static), Activation, "for every 2 HP play 1 random Baang". Migrates clusters P, Q.

_Phase I — Trigger/passive extension_ _depends on C+D+E_

18. New trigger AST types (`summon`, `draw`, `free_ability_played`, `quick_ability_used`, `round_start_or_activation`); `PassiveManager` registers structured passives (removing the silent `custom` drop). Migrates remaining passive clusters.

_Phase J — Rules-completeness enforcement + cleanup + docs_ _depends on all_

19. Remove the `custom` skip in `EffectResolver` (unknown types throw); repurpose `EFFECT_UNSUPPORTED`; remove the `handler` field from the contract.
20. Completeness audit test (fail on any `custom` outside the allowlist), per-cluster integration matrix, full suite + determinism.
21. Docs updates (list below), applied incrementally per phase.

**Relevant files**

- `card-compile.js` — remove `parseEffectText`/`dslObject`/custom fallback; validator + normalizer
- `card-source.schema.json`, `compiled-cards.schema.json` — closed effect schemas
- `data/cards/**/*.yml` — all 82 files migrate (regenerated `cards.json` is a build artifact)
- `EffectResolver.js` — `sequence`/`conditional`; remove custom skip
- `TargetResolver.js` — new descriptors/filters/selectors
- `handlers` — ~15 new `BaseHandler` subclasses (registered via `handlerRegistry`, key = DSL type)
- `services` — new `PredicateEvaluator`, `GlobalRuleRegistry`; extend `PassiveManager`, `TriggerManager`, `LifecycleEngine`, `UnitService`
- `ModifierStack.js` — modifier vocabulary + conditional gating
- `AttributeRegistry.js` — `JeonsulsaEngine`
- `EventCatalog.js`, `GameState.js` — new events; deck-history tracking
- Tests: `handlers`, `tests/integration/`, `tests/regression/`

**Docs updates** (per `docs_update.md` conventions, incremental): `COMPILED_CARD_DSL.md` (rewrite — structured source, closed catalog, text display-only), `HANDLER_SYSTEM_ARCHITECTURE.md` (handler table, structural nodes, custom removal), `TARGETING_ARCHITECTURE.md`, `PASSIVE_SYSTEM_ARCHITECTURE.md`, `TRIGGER_SYSTEM_ARCHITECTURE.md`, `MODIFIER_STACK_ARCHITECTURE.md`, `ATTRIBUTE_SYSTEM_ARCHITECTURE.md` (Jeonsulsa), `SERVICE_LAYER_ARCHITECTURE.md` (new services). `RULES.md` is untouched — cards are made to match it.

**Verification**

1. Run focused Jest per phase and the full suite at the end: `node --experimental-vm-modules node_modules/jest/bin/jest.js` (bare `npx jest` breaks ESM).
2. `npm run compile:cards` after each migration batch; the audit test asserts zero `type: "custom"` outside the allowlist.
3. At least one playthrough integration test per cluster (24).
4. Determinism/replay tests for new random/choice paths; coverage maintained (~97% stmts).

**Decisions**

- Structured DSL in YAML; text is display-only and never parsed; compiler fail-fast on unsupported structures.
- No dual paths: regex matcher removed entirely, all 82 YAML files migrate.
- `custom` fallback and `handler` field removed; the registry is the single type→handler mapping; unknown types throw.
- `unreachable` → `deckConstraints` only. `RULES.md` unchanged. Migration interleaved with primitive implementation, each batch compiles + tests green.

**Further Considerations**

1. The "started the game with Ha Jinsung in your deck" predicate requires `GameState` to record starting deck composition — confirm fidelity (presence vs exact copy) during Phase C.
2. Test placeholders `_test_Equipment`/`_test_Skill` — convert to structured no-op nodes in the allowlist, or remove from the production set.
3. Cluster T's "next time you play Baang this turn, play it 4 more times" needs a delayed/queued trigger — confirm in scope now or defer as a documented follow-up.
