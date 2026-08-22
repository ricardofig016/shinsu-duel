## Plan: Rules-complete card effect engine

**TL;DR** — The runtime handler architecture (`EffectResolver` + `HandlerRegistry` + `BaseHandler` validate/execute + target pre-resolution + pending-decision protocol + service-layer mutations + `ModifierStack`) is sound and will be kept. Phases A–E are complete: all 93 YAML cards are structured DSL (zero `custom`/`handler`, enforced by the landed `CardDataAudit` test), structured unit and card target resolution (including `random`/`choose`/`cost`/`lowest_hp` selection and the explicit `series` grouping) is runtime-supported, `sequence`/`conditional` plus all seven predicates are wired, shared-target sequences (`targets` + `target: { link: sequence }`) resolve one target set across steps, and the full effect-primitive catalog has handlers with tests. The remaining work is runtime integration of grammar that already landed in the schemas/compiler (Phases F–J): modifier/global-rule runtime, Jeonsulsa mechanics, extended passive triggers, and rules-completeness enforcement. Full suite baseline: 81 suites / 730 tests green.

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

2. Lifecycle: `slay`, `transform`/revert (reuse `LifecycleEngine.killUnit`/`transformUnit`).
3. Zone movement: `summon`, `steal`, `discard`, `disarm`, `switch_position` (`create_card` landed in Phase B6).
4. Unit state: `remove_traits` (Silence), `copy_traits`, `grant_random_trait`, `peek_hand` (observer-only).
5. Abilities: `copy_ability` ("use an enemy ability"), `repeat_play` (delayed repeat + wildcard when `cardName` omitted).
6. Events: `card:discarded`, `unit:stolen`, `unit:silenced`, `hand:peeked`; audit points closed with `PhaseEHandlersIntegration.test.js`.

_Phase F — Modifier system runtime (always-on passives)_ _depends on C+D_

The modifier grammar is fully landed (`modify_stat` damage/heal/hp/cost/damage_taken with `when`/`source` filters, `modify_cost` with `if`, `modify_condition` with `if`, `modify_keyword` quick/free/first, `modify_targeting` ignore_taunt/untargetable_by, `modify_repeat`, `retain_equipment`); the remaining work is **runtime**:

7. `PassiveManager` registers trigger-less modifier passives (currently only `conditional` always-on re-evaluates; modifier/grant branches skip) and equipment `effects` modifier nodes via the same always-on, revoke-safe, re-entrancy-guarded path. Predicate-gated modifiers evaluate `if` via `PredicateEvaluator`.
8. Consultation points consume the ModifierStack: damage/heal amplifiers (`DealDamageHandler`/`HealHandler`/`UnitService`), `damage_taken` with `source` filter, cost modifiers (action cost checks), Quick/Free keyword + `first`-per-round (action gating), targeting restrictions (`TargetResolver`), condition amplification (`GiveConditionHandler`), ability repeat (`modify_repeat`), and `retain_equipment` on return to hand.
9. Migrates clusters B, F, V, I plus the newer modifier cards (Edin Dan, Phobos, Beta, Karaka, etc.).

_Phase G — Global rule modifiers (landmarks)_ _depends on C+D+E_

10. `global_rule` grammar is landed (`disable_passives`, `grant_global_trait`, `grant_global_condition`, `condition_stack_cap`, `prevent_evolve`, `prevent_equip`; `position` scoping incl. the `chosen` sentinel). Remaining: `GlobalRuleRegistry` + hooks — `disable_passives` (suppress `PassiveManager`), `condition_stack_cap` (cap condition stacking), `prevent_evolve`/`prevent_equip` (gate `LifecycleEngine`), `grant_global_*` (position-scoped application, incl. `position: chosen`).
11. `choose_position` handler + stored landmark choice (Name Hunt Station) resolve the `chosen` sentinel.
12. Migrates cluster N.

_Phase H — Jeonsulsa attribute engine_ _depends on E_

13. `play_jeonsul_baang` node is landed and Conduit's passives are migrated (`round_start_or_activation` trigger). Remaining: `JeonsulsaEngine` in `AttributeRegistry` — deploy mechanic ("heal 2 HP from or summon Conduit on the enemy backline"), Conduit lifecycle (round-start Ghost, self-slay when no enemy Jeonsulsa, "for every 2 HP play 1 random Jeonsul Baang on a random ally"), the Activation event backing `round_start_or_activation`, and the `play_jeonsul_baang` handler (seeded-random Lightning/Thunder/Static Baang on a random ally).
14. Migrates clusters P, Q.

_Phase I — Trigger/passive extension_ _depends on C+D+E_

15. `PassiveManager._parseTrigger` currently wires only `round_start`/`round_end` and silently skips every other trigger. Wire the full trigger set used by compiled cards: `deploy`, `summon`, `draw`, `reclaim`, `equip`, `skill_played`, `dies`, `ally_dies`, `deal_damage`, `free_ability_played`, `quick_ability_used`, `round_start_or_activation`, `evolve`, `attack` — adding events where none exists (attack, free/quick ability usage, activation). Migrates the remaining passive clusters (X, Y, F, V, T).
16. `enemy_dies` stays in the grammar (unused; kept per user).

_Phase J — Rules-completeness enforcement + cleanup + docs_ _depends on all_

17. Complete the last effect primitives that currently skip via `EFFECT_UNSUPPORTED`: `grant_affiliation` (Michael), `return_to_hand` (Beta) — `choose_position` is handled in Phase G.
18. Remove the `custom` skip in `EffectResolver` (unknown types throw); repurpose `EFFECT_UNSUPPORTED` (retained only for `CreateCardHandler` `generated_by` resource skips); the `handler` field is already gone from the compiled contract (kept out by the audit test).
19. Per-cluster integration matrix (the zero-`custom` audit test is landed), full suite + determinism.
20. Docs updates (below), applied incrementally per phase.

**Relevant files**

- `EffectResolver.js` — structural nodes (done); register new handlers; remove skip (Phase J)
- `TargetResolver.js` — targeting restrictions (Phase F)
- `services/PassiveManager.js` — always-on modifiers (F) + full trigger mapping (I)
- `services/GlobalRuleRegistry.js` (new, Phase G); `services/LifecycleEngine.js`, `services/UnitService.js`, `services/ZoneService.js`, `services/PredicateEvaluator.js`
- `attributes/JeonsulsaEngine.js` (new, Phase H); `attributes/AttributeRegistry.js`
- `ModifierStack.js` — modifier vocabulary + consultation helpers (Phase F)
- `EventCatalog.js`, `GameState.js` — new events (F/G/H/I); deck-history tracking (done)
- `handlers` — new `BaseHandler` subclasses (registered via `handlerRegistry`, key = DSL type)
- Tests: `handlers/`, `tests/integration/`, `tests/regression/`

**Docs updates** (per `docs_update.md` conventions, incremental): `MODIFIER_STACK_ARCHITECTURE.md` (Phase F), `ATTRIBUTE_SYSTEM_ARCHITECTURE.md` (Jeonsulsa, Phase H), `PASSIVE_SYSTEM_ARCHITECTURE.md` + `TRIGGER_SYSTEM_ARCHITECTURE.md` (Phase I), plus incremental updates to the docs already written for Phases B–E (`COMPILED_CARD_DSL.md`, `HANDLER_SYSTEM_ARCHITECTURE.md`, `TARGETING_ARCHITECTURE.md`, `SERVICE_LAYER_ARCHITECTURE.md`, `EVENT_BUS_ARCHITECTURE.md`). `RULES.md` is untouched — cards are made to match it.

**Verification**

1. Run focused Jest per phase and the full suite at the end via `npm run test` (the script wraps Jest with the required Node flags; bare `npx jest` breaks ESM). Baseline 81 suites / 730 tests green.
2. At least one playthrough integration test per cluster (24).
3. Determinism/replay tests for new random/choice paths; coverage maintained (~97% stmts). Hwayeomsa/Incinerate integration is covered by the `create_card` handler (green).
4. `npm run validate:cards` + `npm run compile:cards` whenever grammar or cards change.

**Decisions**

- Structured DSL in YAML; text is display-only and never parsed; no dual paths (regex matcher removed).
- The registry is the single type→handler mapping; unknown types throw (Phase J).
- Always-on modifiers and global rules are source-tracked modifiers owned by their unit/landmark (revoke-safe, re-evaluated on the same event set as always-on conditionals).

**Further Considerations**

1. `attack` trigger has no backing event today — RULES.md has no attack action (Shinheuh "attack on behalf" is narrative). Confirm the mapping in Phase I or defer the two Lo Po Bia Ren passives.
2. `given` (skill:applied) and `enemy_dies` are in the grammar but unused by passives; keep the trigger types, no wiring needed.
3. Khun Ran's "heal 2 HP from or summon Conduit on the enemy backline" deploy mechanic is an attribute-engine concern (RULES.md §Jeonsulsa), not card YAML — confirm the engine owns it (Phase H).
