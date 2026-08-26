# Plan: Rules-complete card effect engine

## Summary

The card-effect runtime is nearly complete. The DSL is schema-validated and all 93 cards compile through it. The resolver handles structural nodes and shared-target sequences, targeting covers units and cards, every registered effect type has a handler with tests, and the always-on modifier system is wired end to end. Landmark rules now have runtime enforcement through `GlobalRuleRegistry`, `LifecycleEngine`, `PassiveManager`, and condition application. Four schema types have cards authoring them but no handler. The Jeonsulsa attribute engine is unbuilt. Seven passive triggers are unwired. Unknown effect types still skip instead of throwing.

## What is in place

### DSL, compiler, and audit

`card.schema.json` and `compiled-cards.schema.json` validate the structured grammar. Effect nodes, modifier nodes, rule nodes, predicates, triggers, unit and card targets, keywords as `{code, raw}` objects, `deckConstraints` with required `raw`, card-level `series`, and the top-level `rules:` array on landmark cards are all schema-backed. The rule-node types are `disable_passives`, `grant_global_trait`, `grant_global_condition`, `condition_stack_cap`, `prevent_evolve`, and `prevent_equip`. All 93 cards in `data/cards` compile with zero `custom` and zero `handler`. `CardDataAudit.test.js` asserts that invariant against the checked-in `server/data/cards.json`.

### Resolver, targeting, and predicates

`EffectResolver` resolves `sequence` and `conditional` structurally, runs shared-target sequences (`targets` plus `target: { link: sequence }`) as one decision set, and dispatches every other node through `HandlerRegistry` to a `BaseHandler` subclass that validates then executes. `PredicateEvaluator` implements all seven predicates (`has_unit`, `alone_on_line`, `started_with_card`, `has_equipped`, `has_all_equipped`, `has_condition`, `has_equipment_count`). `GameState` records `startingDeck` and `startedWithCard` reads it.

`TargetResolver` handles unit selection (`random`, `choose`, `cost`, `lowest_hp`, `traitNot`, `shared_affiliation`, `has_passive`, `can_switch`, position filters) and card targets (`resolveCardTargets` + `toCardTargetView`) wired into `compress_shinsu`, `draw_card`, `reclaim_cards`, and `create_card`. Card grouping uses the explicit `series` field via `findCardsBySeries`. `Card.rank` exists.

### Effect primitives

Twenty-nine effect types are registered in `HandlerRegistry` with handler classes. `EffectPrimitivesIntegration.test.js` exercises five primitives (`steal`, `summon`, `copy_ability`, `peek_hand`, `switch_position`) through real fixture cards on the `use-ability-action` path. The rest of the catalog has dedicated handler unit tests only, for example `DealDamageHandler`, `ChargeShinsuHandler`, `CompressShinsuHandler`, `SlayHandler`, `TransformHandler`, `RepeatPlayHandler`, `CreateCardHandler`, `CopyTraitsHandler`, `DisarmHandler`, `SummonHandler`, `GrantRandomTraitHandler`, `RemoveConditionHandler`, `PeekHandHandler`, `SwitchPositionHandler`, and `CopyAbilityHandler`, all under `tests/handlers/`.

### Always-on modifier system

Trigger-less `modify_*` and `retain_equipment` passives and equipment `effects` modifier nodes route through `PassiveManager` to `ModifierService` into the `ModifierStack`. Application is predicate-gated by `if`, position-scoped by node `position`, and suppressed by Disabled. `ModifierStack` stores filter metadata and exposes the consultation helpers (`getDamageDealt`, `getHealModifier`, `getDamageTaken`, `getConditionAmplifier`, `getKeywords`, `getTargetingRules`, `getRepeat`, `hasRetainEquipment`, `getAbilityAugments`, `matchesUnitFilter`). `ModifierService.getEffectiveCost` is the single cost authority, wired into `PlaySkillAction`, `DeployUnitAction`, and `EquipEquipmentAction`.

`PassiveManager._parseTrigger` wires timed passives for `round_start`, `round_end`, `skill_played`, `deal_damage`, `quick_ability_used`, `summon`, and `deploy`. `TriggerManager` handles `given` (Khun Ran's "Redan is played on me" evolve trigger) and the other `evolveInto` triggers.

### Landmark rules

The landmark cards (`name_hunt_station`, `water_stadium`, `floor_of_death`) author their rules as a top-level `rules:` array, not as passives. `GlobalRuleRegistry.registerUnit`, called from `LifecycleEngine` on deploy, applies each rule to the `ModifierStack` as a source-tracked entry with `type: "rule"`, `key: rule.type`, and `sourceType: "landmark"`. `unregisterUnit` revokes them by source on removal. `GlobalRuleRegistry`, `LifecycleEngine`, `PassiveManager`, and `GiveConditionHandler` consume these entries at their own rule boundaries.

## Remaining work

### Landmark rule enforcement

Build rule enforcement around the existing `GlobalRuleRegistry` and `ModifierStack` provenance model. The registry remains the owner of landmark rule lifetime, validation, chosen-position state, and rule queries. It must expose active-rule lookups by rule type and affected unit, while enforcement stays at the service that already owns the behavior. Do not route rules through `ModifierService`, and do not copy rule state into unrelated services.

#### Phase 1: make rule state queryable and scoped

1. Extend `GlobalRuleRegistry` to validate every compiled rule before registration. Accept only the six schema-backed rule types, require the fields already conditional in the card schemas, validate positive condition caps, and reject malformed `position` values instead of silently registering an unusable rule. Add duplicate-registration protection so repeated lifecycle callbacks cannot stack the same landmark's rules.
2. Store a landmark's selected position as runtime state on the landmark unit, using a serializable `chosenPositionCode` field. Resolve `position: chosen` through the existing pending-decision continuation flow, with the landmark owner choosing one legal position once during deployment. The choice must complete before the rule entries are considered active, remain stable through re-evaluation and serialization/replay, and be discarded when the landmark leaves play. A rule with an explicit position is active immediately.
3. Add rule queries that inspect enabled `type: "rule"` entries, match both sides of the battlefield, and treat explicit positions as continuous scopes. A chosen-position rule affects units already in the selected position and later entrants, including units that switch into it. Units with `placedPositionCode === null` do not match a position-scoped rule. Global rules without a position apply to all applicable units.
4. Add one reconciliation path that runs after rule registration/removal and after units deploy, move, transform, or are destroyed. It must revoke and rebuild only landmark-owned grants, deduplicate repeated reconciliation, and leave each source's modifiers isolated from every other landmark source.

#### Phase 2: wire each consumer at its authority

5. Wire `disable_passives` into `PassiveManager`'s registration, trigger dispatch, and always-on re-evaluation. Consult the active rule registry at execution time so a rule added after a passive is registered suppresses it, and a removed rule lets it resume. Suppress all passives in scope, including the source landmark's passives when the rule matches that landmark. Do not remove native traits, conditions, abilities, equipment effects, or the rule entries themselves. Name Hunt Station's `choose_position` passive is unrelated to Floor of Death's `disable_passives` rule and must continue to resolve normally.
6. Gate evolution in `LifecycleEngine.transformUnit` for evolution calls, not only in `TriggerManager`. The gate must run before card/state mutation and must distinguish evolution from non-evolution transformations such as ignition. When blocked, skip the attempt without payment, partial transformation, or pending retry; a later eligible trigger can try again after the rule no longer applies.
7. Gate `LifecycleEngine.attachEquipment` using the target bearer's normal `placedPositionCode`, before cost calculation/payment, detachment, hand mutation, or replacement. Null-position units do not match chosen-position rules. Multiple active blockers continue to block until all applicable sources are removed.
8. Implement `grant_global_trait` and `grant_global_condition` as landmark-source modifiers on every currently matching unit and every future matching unit. Grants apply on both boards and exclude null-position units for chosen scopes. Reconciliation must remove only stale entries from that landmark source and reapply the current set, honor Immune for conditions, avoid duplicate condition accumulation, and preserve normal condition cleanup at round end. Reapply continuous condition grants after round cleanup and whenever matching scope or rule state changes so Rooted remains active while the landmark remains in play.
9. Enforce `condition_stack_cap` in the central condition-application path used by `GiveConditionHandler`, after amplifier calculation and before `ModifierStack.apply`. Treat the cap as per condition per unit, cap the merged amount rather than discarding the application, and use the minimum active cap when several landmarks apply. Cap checks must cover ordinary and global grants, immunity, existing stacks, expiration, and cap removal without mutating unrelated conditions.

#### Phase 3: integration and regression coverage

10. Extend `GlobalRuleRegistry` tests for rule validation, active queries, chosen-position persistence, duplicate registration, scope matching, source isolation, and revocation. Add focused enforcement tests for passive suppression/resumption, evolution and equipment gates, global trait/condition reconciliation, and cap combination semantics.
11. Add fixture YAML/cards for Name Hunt Station, Water Stadium, and Floor of Death using the test-owned catalog. Add integration tests that deploy each real landmark, exercise its behavior against units on both boards, move/deploy units into and out of scope, remove or replace the landmark, and assert that all landmark-owned rules and grants disappear cleanly. Verify Name Hunt's pending position choice and serialized state.
12. Run `npm run compile:fixtures`, the focused landmark/passive/lifecycle/condition tests, and `npm run test`. Each test must inject cards through `GameState({ options: { cards }})` rather than reading shipped card data.

Completion criterion: all six rule types validate and have consumers at their authoritative boundaries; chosen-position rules persist and apply continuously; global grants and caps reconcile without duplicate or leaked modifiers; automatic and direct lifecycle paths obey blockers; and integration tests prove real landmark deploy, behavior, replacement/removal, serialization, and clean revocation.

### Effect handlers still missing

Four schema types have cards authoring them but no handler. Resolving any of them falls through to the `EFFECT_UNSUPPORTED` skip.

- `grant_affiliation` (Michael's ability)
- `return_to_hand` (Beta's quick ability). `retain_equipment` is already applied and readable via `ModifierStack.hasRetainEquipment`, so a consumer is ready for it.
- `choose_position` (Name Hunt Station's deploy-triggered passive). The deploy trigger is already wired, so the handler and the stored choice are the missing pieces.
- `play_jeonsul_baang` (Conduit's round-start passive)

Completion criterion: each handler is registered in `HandlerRegistry`, has validate and execute tests, and works through the card that uses it.

### Jeonsulsa attribute engine

The `attributes` directory holds `AttributeRegistry.js`, `AnimaEngine.js`, and `HwayeomsaEngine.js`. There is no Jeonsulsa engine, and `AttributeRegistry` registers only `anima` and `hwayeomsa`. The mechanics in RULES.md §Jeonsulsa are unimplemented. That includes the deploy effect (grant the enemy Conduit +2 HP or summon a Conduit on the enemy backline), the Conduit lifecycle (round-start Ghost, self-slay when no enemy Jeonsulsa, one random Jeonsul Baang per 2 HP on a random ally), the Activation event backing `round_start_or_activation`, and the `play_jeonsul_baang` handler with seeded-random Lightning, Thunder, and Static Baang. Conduit's card authors these as passives with the `round_start_or_activation` trigger, which `_parseTrigger` does not wire.

Completion criterion: a jeonsulsa engine is registered, the Activation event exists in `EventCatalog`, and a Conduit lifecycle test covers deploy, round-start Ghost, self-slay, and Baang play with seeded randomness.

### Passive trigger wiring

`PassiveManager._parseTrigger` skips `draw`, `reclaim`, `equip`, `dies`, `ally_dies`, `free_ability_played`, and `evolve`. Wire each to its `EVT` constant, adding events where none exist. The events for the first six exist (`CARD_DRAWN`, `CARD_RECLAIMED`, `EQUIPMENT_ATTACHED`, `UNIT_KILLED`, `UNIT_EVOLVED`). Free-ability usage has no event yet; the `quick` flag on `UNIT_ABILITY_USED` already exists.

Completion criterion: every trigger used by compiled cards registers a passive, and a test fires each event and observes the passive effect.

### Rules-completeness enforcement

`EffectResolver` skips unknown effect types through `EFFECT_UNSUPPORTED` as a transitional path. Make unknown types throw. Keep `EFFECT_UNSUPPORTED` only for `CreateCardHandler`'s `generated_by` resource skips. The `handler` field is already gone from the compiled contract.

Completion criterion: an unknown effect type raises, no test depends on the silent skip, and the audit test still passes.

## Approach

- Build each missing handler as a `BaseHandler` subclass registered in `HandlerRegistry` by DSL type, following the validate and execute contract of the existing handlers. Zone movement mirrors `SummonHandler`; lifecycle work mirrors `SlayHandler`.
- For rule enforcement, consult enabled `type: "rule"` entries through `GlobalRuleRegistry` at the existing authority boundaries. `LifecycleEngine` gates evolution and equipment before mutation. `PassiveManager` enforces `disable_passives`. The condition application path enforces `condition_stack_cap`. A registry-owned reconciliation path applies source-tracked global grants and removes stale entries. Key every grant by the canonical landmark source id.
- The `chosen` sentinel needs a stored landmark choice. Name Hunt Station's existing deploy-time `choose_position` passive should complete that choice through the pending-decision flow before the chosen rules activate. The choice belongs on the landmark unit so snapshots and serialized state can carry it.
- Update `docs/MODIFIER_STACK_ARCHITECTURE.md`, `docs/SERVICE_LAYER_ARCHITECTURE.md`, and `docs/PASSIVE_SYSTEM_ARCHITECTURE.md` only where the new rule query, grant ownership, lifecycle ordering, or passive suppression contract changes those documents. Do not document implementation sequencing.

## Relevant files

- `EffectResolver.js` — structural nodes done; make unknown types throw
- `services/PassiveManager.js` — wire `draw`, `reclaim`, `equip`, `dies`, `ally_dies`, `free_ability_played`, `evolve`
- `services/GlobalRuleRegistry.js` — exists; the consumers are the missing part
- `services/LifecycleEngine.js` — evolve and equip rule gating
- `attributes/AttributeRegistry.js` — register the Jeonsulsa engine; `attributes/JeonsulsaEngine.js` is new
- `EventCatalog.js` — Activation event and the free-ability event
- `handlers/` — four new `BaseHandler` subclasses, registered via `handlerRegistry`
- Tests — `tests/handlers/`, `tests/integration/` (mirror `EffectPrimitivesIntegration.test.js`), `tests/services/`

## Verification

- Run focused Jest per area during work and the full suite at the end via `npm run test`.
- Each new handler gets unit tests plus at least one card-level integration test on the `use-ability-action` or deploy path.
- Add determinism and replay coverage for the new random and choice paths. `SeededRng` and `ReplayDriver` already exist.
- Run `npm run validate:cards` and `npm run compile:cards` when grammar or cards change.

## Decisions

- Structured DSL in YAML. Text is display-only and never parsed. No dual paths.
- `HandlerRegistry` is the single type-to-handler mapping. Unknown types throw once the catalog is complete.
- Always-on modifiers and landmark rules are source-tracked entries owned by their unit or landmark, revoked by source, and re-evaluated on the same event set as always-on conditionals.

## Further considerations

- `given` is handled by `TriggerManager`, not `PassiveManager`. `enemy_dies` stays in the grammar unused. Neither needs passive wiring.
- Khun Ran's "grant the enemy Conduit +2 HP or summon a Conduit" deploy mechanic belongs in the Jeonsulsa attribute engine (RULES.md §Jeonsulsa), not in card YAML. Confirm the engine owns it before authoring card data.
