# Plan: Rules-complete card effect engine

## Summary

The card-effect runtime is nearly complete. The DSL is schema-validated and all 93 cards compile through it. The resolver handles structural nodes and shared-target sequences, targeting covers units and cards, every registered effect type has a handler with tests, and the always-on modifier system is wired end to end. What remains is runtime that does not exist yet. Landmark rules have a registry but no consumer. Four schema types have cards authoring them but no handler. The Jeonsulsa attribute engine is unbuilt. Seven passive triggers are unwired. Unknown effect types still skip instead of throwing.

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

The landmark cards (`name_hunt_station`, `water_stadium`, `floor_of_death`) author their rules as a top-level `rules:` array, not as passives. `GlobalRuleRegistry.registerUnit`, called from `LifecycleEngine` on deploy, applies each rule to the `ModifierStack` as a source-tracked entry with `type: "rule"`, `key: rule.type`, and `sourceType: "landmark"`. `unregisterUnit` revokes them by source on removal. Nothing at runtime consumes those entries yet.

## Remaining work

### Landmark rule enforcement

A consumer for `type: "rule"` entries. Each rule type needs behavior at the right authority.

- `disable_passives` suppresses passive evaluation in scope.
- `prevent_evolve` and `prevent_equip` gate `LifecycleEngine`.
- `grant_global_trait` and `grant_global_condition` apply position-scoped grants.
- `condition_stack_cap` caps condition stacking.

Every rule carries a `position` string, including the `chosen` sentinel. Completion criterion: each rule type has a consumer wired at the correct authority, a test drives a real landmark card through deploy and removal, and the rules revoke cleanly on removal.

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
- For rule enforcement, read `type: "rule"` entries from the `ModifierStack` at the existing authority boundaries. `LifecycleEngine` gates evolve and equip. `PassiveManager` enforces `disable_passives`. Condition application enforces `condition_stack_cap`. `ModifierStack`-scoped grants handle `grant_global_*`. Key everything by the landmark source id from `GlobalRuleRegistry`.
- The `chosen` sentinel needs a stored landmark choice. Name Hunt Station's deploy trigger is already wired, so the `choose_position` handler and the stored choice complete it.
- When each area lands, update the doc that owns it (`PASSIVE_SYSTEM_ARCHITECTURE.md` for triggers, `ATTRIBUTE_SYSTEM_ARCHITECTURE.md` for Jeonsulsa, `MODIFIER_STACK_ARCHITECTURE.md` for rule enforcement) per `plans/prompts/docs_update.md`.

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
