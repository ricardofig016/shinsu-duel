## Plan: Rules-complete card effect engine

**TL;DR** — The runtime handler architecture (`EffectResolver` + `HandlerRegistry` + `BaseHandler` validate/execute + target pre-resolution + pending-decision protocol + service-layer mutations + `ModifierStack`) is sound and will be kept. Phase B has migrated all 82 YAML source cards to structured DSL and the compiler now validates/normalizes them without a `custom` fallback. The zero-`custom` artifact is landed; structured target descriptors (Phase B5a subset) and the `create_card`/Hwayeomsa path (Phase B6) are runtime-supported. The remaining work is runtime integration: the remaining migrated effect handlers, global rules, Jeonsulsa mechanics, and richer passives/triggers.

The original 123 customs decomposed into **24 semantic clusters** (verified against the pre-migration `cards.json`), from metadata (unreachable markers, Quick flags, identity markers) to compound chains, affiliation/name/cost targeting, always-on stat amplifiers, global landmark rules, and Conduit/Jeonsulsa attribute mechanics.

**Steps**

_Phase A — DSL language & contracts (no runtime code)_ (done)

1. Define the source effect grammar: node types, fields; structural nodes `sequence` and `conditional`; target descriptor grammar (add name, affiliation, attribute, cost, random, choice, multi-owner, deck/hand sources); predicate grammar; modifier grammar.
2. Update `card.schema.json` (effect sub-schema — currently plain strings) and `compiled-cards.schema.json` (closed per-type DSL defs; remove `handler`; remove `additionalProperties: true`).
3. Commit the cluster inventory as the migration map artifact (working doc under `plans`), kept updated during migration.

_Phase B — Compiler revamp + full DSL migration_ (source work done; artifact landing blocked)

4. Rewrite `card-compile.js`: delete the regex matcher and `dslObject` custom fallback; validate/normalize structured nodes; fail-fast with descriptive errors; preserve `raw`. Update `card-validate.js` and `card-create.js`. **Done.**
5. Migrate all 82 YAML files to structured DSL (atomic source migration): metadata clusters (`unreachable` → `deckConstraints` with required `raw`, `quick` → `quick` marker node / `quick: true`, identity markers → `keywords` + visible `noop` line), compound chains → `sequence`/`conditional`, passive triggers → structured `trigger` objects, and every primitive/modifier/global-rule/Jeonsulsa effect. **Done.**
6. Source invariant: `npm run validate:cards` passes for all 82 YAML files. **Done.**
7. Artifact invariant: regenerate and land `server/data/cards.json` with zero `type: "custom"`/`handler`. **Done.** Structured targeting (B5a subset) and `create_card`/Hwayeomsa (B6) were pulled forward into Phase B.

> **Phase B outcome** — all 82 YAML files are structured and source validation passes. `npm run compile:cards` can emit a zero-`custom`/zero-`handler` artifact, but it is not yet checked in because the runtime still expects legacy string targets and does not handle all migrated types. The schema contract grew beyond Phase A to close the last clusters: `keywords`, `deckConstraints` (required `raw`), `noop`, `quick`, `repeat_play`, `free`, `choose_position`, `play_jeonsul_baang`; `summon.from` (`deck`/`hand`/`deck_or_hand`/`game`); OR filter arrays (`filterValue`); modifiers including `damage_taken`/`when`/`source`/`modify_condition`; global rules including `grant_global_condition`; triggers including `reclaim`/`dies`/`cardType`; `has_all_equipped`; and `owner: self|enemy`.
>
> **⚠️ Runtime landing caveat** — the regenerated `cards.json` is landed. Structured target objects (B5a) and Fire Core's `create_card`/Hwayeomsa path (B6) are runtime-supported. Remaining skips are the still-unimplemented migrated types (Phases C–I).

_Phase C — Resolver structural nodes & predicates_ (done)

7. `sequence` node in `EffectResolver.js` (recursive, reusing the pending-continuation deferral pattern). _depends on 4_ **Done.**
8. Predicate evaluator service + `conditional` node (if/then/otherwise) for board/deck-state checks ("if i have an allied Shinheuh", "alone on the frontline", "started the game with X"). _depends on 4_ **Done.** All six predicates implemented in `PredicateEvaluator`; trigger-less `conditional` passives wired in `PassiveManager` with event-driven revoke-and-reapply re-evaluation.

_Phase D — Targeting extensions_ _(parallel with C)_

9. `TargetResolver`: name/affiliation/attribute/cost filters, seeded-random selection, choice decisions ("of your choice"), multi-owner targets ("both players' fields"), deck/hand/game sources, extended `resolveCardTarget` selectors, and consume the structured `target: {side, scope, count, …}` object form. The structured `{side, scope, count, filters}` subset — including affiliation/attribute/name filters and array-OR rank/position — already landed in Phase B5a; remaining: `random`/`choice`/`cost` selection and deck/hand/game sources.

_Phase E — New effect primitives_ (each: handler + service integration + validate/execute tests) _depends on C+D_

10. Lifecycle: `slay`, `transform`/revert (reuse `LifecycleEngine`).
11. Zone movement: `summon`, `create_card` (**landed in Phase B6** — exact-name create + `generated_by`/Hwayeomsa delegation), `steal`, `discard`, `disarm`, `switch_position`.
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
- `card.schema.json`, `compiled-cards.schema.json` — closed effect schemas
- `data/cards/**/*.yml` — all 82 files migrated (regenerated `cards.json` remains blocked from landing until Phase D/E runtime integration)
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
2. `npm run validate:cards` after B4 — passes for all 82 YAML files. `npm run compile:cards` can generate a zero-`custom` artifact, but checked-in artifact landing is deferred until Phase D/E runtime blockers are resolved; then rerun compiled-schema validation and the audit test.
3. At least one playthrough integration test per cluster (24).
4. Determinism/replay tests for new random/choice paths; coverage maintained (~97% stmts). Hwayeomsa/Incinerate integration is covered by the Phase B6 `create_card` handler (green).

**Decisions**

- Structured DSL in YAML; text is display-only and never parsed; compiler fail-fast on unsupported structures.
- No dual paths: regex matcher removed entirely, all 82 YAML files migrate.
- `custom` fallback and `handler` field removed from the source/compiled contract; the legacy checked-in `cards.json` still contains them until the runtime artifact gate is cleared. The registry is the single type→handler mapping; unknown types throw.
- `unreachable` → `deckConstraints` with required display `raw`; `Quick`/identity markers retain visible `raw` text through marker/noop nodes. `RULES.md` unchanged. Migration interleaved with primitive implementation, each batch compiles + tests green.

**Further Considerations**

1. The "started the game with Ha Jinsung in your deck" predicate requires `GameState` to record starting deck composition — **resolved in Phase C: presence (deck construction forbids duplicates, so presence == exact copy).** Note: "Ha Jinsung" has no card in the current set, so the predicate evaluates false until that card lands.
2. Test placeholders `_test_Equipment`/`_test_Skill` — convert to structured no-op nodes in the allowlist, or remove from the production set.
3. Cluster T's "next time you play Baang this turn, play it 4 more times" needs a delayed/queued trigger — confirm in scope now or defer as a documented follow-up.
