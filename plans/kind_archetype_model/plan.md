# Plan: Migrate to `kind` archetype model

**TL;DR** — Introduce a first-class `kind` discriminator (`standard | shinheuh | landmark | conduit`) on unit cards, keep `type: unit | skill | equipment`, shrink `positions` back to the 5 main positions, replace the `global_rule` grab-bag with a landmark-owned `rules` list, and dispatch on `kind` + a first-class `line` at runtime. This deletes the four name/position special cases (`isConduit`, `positionsRequiringNullRank`, `isLandmark`, `normalizePositionFilter`) and the `positions: ["landmark"]` dummy hack.

---

## Why this migration exists (read this first)

This project follows `AGENTS.md`: treat every change as part of the project's long-term resurrection; prefer correct, clean architecture over backward-compatible patches; fix underlying design imperfections instead of adding special cases; keep explicit, schema-validated contracts with a single source of truth.

The `unit` card type accreted "what kind of board thing is this" through **four unrelated mechanisms** — that is the smell driving this migration:

1. **Position strings as kinds.** `landmark`, `frontline shinheuh`, `backline shinheuh` live in `positions`, plus a `special: true` flag in `server/data/positions.json`.
2. **A name-based hardcode for Conduit.** `isConduit(card)` is literally `card.name.trim().toLowerCase() === "conduit"` in both `scripts/card-validate.js` and `scripts/card-compile.js`, injecting `positions: ["landmark"]` + `rank: "regular"` as **dummy data so AJV passes**. This is a name-convention-as-contract hack — the exact anti-pattern AGENTS.md forbids (the same one previously removed when `findCardsByFamily` was replaced by the explicit `series` field).
3. **A `global_rule` grab-bag.** One `modifierNode` type with six unrelated `rule` values (`disable_passives`, `grant_global_trait`, `grant_global_condition`, `condition_stack_cap`, `prevent_evolve`, `prevent_equip`) plus loose `position`/`cap`/`trait`/`condition` fields — only ever meaningful on landmarks, but expressed through the unit-passive/modifier grammar. Landmark rules are **not** unit passives: `RULES.md` already separates them in prose (Irregular: "unit passives have no effect on me … also covers landmark passives").
4. **Runtime position-string checks.** `LifecycleEngine` landmark-replacement via `positionCode === "landmark"`, `UseAbilityAction` shinheuh-slot via position-code membership, `GameState` combat-slot codes derived from a `!special` filter.

Landmarks also differ from units on many axes (no rank, no combat slot, no abilities, no evolve, 1-per-player, battlefield-wide rules), which is why they kept needing patches. Shinheuh (special combat slot, no rank) and Conduit (no position at all, spawns via Jeonsulsa mechanics) are milder versions of the same problem.

**Goal:** one schema-validated closed enum `kind` as the single source of truth; runtime dispatch on `kind`/`line` instead of position strings; landmark rules as a first-class `rules` list.

---

## Target design (authoritative model)

- Card `type` stays `unit | skill | equipment` (how a card is played / which zones it lives in). `kind` is a **new unit-only field**: `standard | shinheuh | landmark | conduit` (what role the card plays on the board). `standard` is the default; every unit card has exactly one kind.
- `positions` shrinks to the **5 main positions only**: `fisherman | light bearer | scout | spear bearer | wave controller`. Special kinds have NO positions.
- New unit-only **`line`**: `frontline | backline`.
  - `standard` — line is derived at deploy from the chosen position (not authored).
  - `shinheuh` — line IS authored (`bull`, `stone_doll` = frontline; backline shinheuh exist in the ruleset).
  - `landmark` / `conduit` — always backline by kind (not authored).
- Runtime placement: `Unit.line` is first-class; `placedPositionCode` = the chosen main position for `standard`, **`null` for special kinds**.
- New **landmark-only `rules` list** (always-on battlefield rules) **replaces `global_rule`** in `modifierNode`. Rule types: `disable_passives`, `grant_global_trait` (trait + target), `grant_global_condition` (condition + target), `condition_stack_cap` (cap), `prevent_evolve`, `prevent_equip` — the last two optionally scoped by `position` including the `chosen` sentinel (Name Hunt Station's `choose_position` deploy choice).
  - Landmark **triggered** effects (Hell Express `round_start`, Wooden Horse `quick_ability_used`, The Hand of Arlen `free_ability_played`/`dies`) **stay in `passives`**. `rules` = always-on only.
- `kind` (and `line` where front/back distinction matters) become **filter vocabulary**: add to `unitTarget`, `unitFilter`, `predicateTarget`, and `cardTarget`. This replaces the `position: shinheuh` → `[frontline-shinheuh, backline-shinheuh]` alias everywhere, including `summon`/`steal` card targets and the `trigger.source: shinheuh` matching.
- **Orthogonality:** `kind` is structural/exclusive. `attributes` (anima, irregular, living ignition weapon, …) are additive/behavioral and stay untouched. Do **not** fold attributes into `kind`.

---

## Current state (verified 2026-08-23)

- 93 cards (units/skills/equipment), all schema-clean; compiled `server/data/cards.json` has zero `custom`/`handler` DSL nodes.
- Card pipeline: `data/cards/**/*.yml` → `scripts/card-validate.js` + `schemas/card.schema.json` (source) → `scripts/card-compile.js` → `server/data/cards.json` (validated by `schemas/compiled-cards.schema.json`). **Never hand-edit `cards.json`** — edit YAML and recompile. Commands: `npm run validate:cards`, `npm run compile:cards`, `npm run compile:fixtures`.
- **Special shipped cards (9):** landmarks — `floor_of_death`, `water_stadium`, `name_hunt_station`, `hell_express`, `the_hand_of_arlen`, `wooden_horse`; shinheuh — `bull` (frontline), `stone_doll` (frontline); conduit — `conduit`.
- **Referencing cards (4):** `sunwoo_nare` (`position: shinheuh` filter + `trigger: { type: summon, source: shinheuh }`), `lo_po_bia_ren` (frontline/backline shinheuh position filters in `modify_ability` passives + `position: [frontline-shinheuh, backline-shinheuh]` card targets in summon/steal), `khun_ran` + `khun_ran_evolved` (heal target `name: Conduit` — a name filter, **UNAFFECTED** by this migration).
- **`global_rule` has NO runtime handler today** (the implementation plan's later phase hasn't landed; unregistered modifier types are silently skipped on the always-on path). The `rules` registry is **greenfield** — wire it as the landing spot; behavior parity today means rules were previously no-ops.
- **`JeonsulsaEngine` (Conduit spawn, per-2-HP Jeonsul Baang) is NOT landed either.** This migration only changes how Conduit is _described_ (kind, no position, unreachable); its runtime mechanics are out of scope.
- `IdFactory.landmarkSource` is only exercised by its own test (effectively dead production code). Keep or align, but don't let it block.
- Frontend (`public/`) is already broken and deferred — out of scope.

---

## Sequencing reality (important)

Phases 1–3 are **not independently shippable**: the schema enums feed `validate:cards`/`compile:cards`/`compile:fixtures`, and `server/game/tests/fixtures/FixtureCardAudit.test.js` validates fixtures against `positions.json` + `compiled-cards.schema.json`. So the moment `positions.json` or the schema enum shrinks, the shipped cards and fixtures must already be migrated or every compile/audit step fails. **The first green checkpoint is effectively after Phase 3's recompile**; treat phases 1–3 as one atomic unit. Phases 4–5 change runtime dispatch and must land with the test updates of Phase 7 for the suite to stay green. The phases below are a logical/commit organization, not independently shippable milestones — intermediate commits may be red by design, but keep them ordered.

---

## Test & process conventions (from AGENTS.md + docs/TESTING.md)

- Run tests via **`npm run test` ONLY** (wraps jest with the required `--experimental-vm-modules` flag). Never bare `npx jest`.
- Tests **never depend on shipped card data**. Resolve cards against the test-owned fixture catalog `server/game/tests/fixtures/cards.js`, injected via `GameState` `options.cards` / `tests/utils.js` helpers. Fixtures are authored as YAML in `server/game/tests/fixtures/yaml/**` and compiled by `npm run compile:fixtures` → `tests/fixtures/cards.json`. Never hand-edit the compiled fixture shape.
- Fixture naming: named fixtures use explicit `cardId` 1000+ with a `Test` prefix; generic fillers are `Test Filler N` with ids 1..40 (they must stay the lowest ids — deck building slices the first eligible). **Naming trap:** shipped `data/cards/units/stone_doll.yml` is a shinheuh, but fixture `tests/fixtures/yaml/units/stone_doll.yml` ("Test Stone Doll") is a **standard** fisherman — they are unrelated.
- Schema/DSL changes must land in **BOTH** `schemas/card.schema.json` (source) and `schemas/compiled-cards.schema.json` (compiled), plus `docs/COMPILED_CARD_DSL.md`.
- Docs are a single source of truth: each concept documented once, in one file; update only affected sections. **Never write implementation-history/phase wording into code, tests, or docs** ("Phase X", "phase 1/2", "later phase" are banned by AGENTS.md) — refer to components by architecture (e.g., "the global-rule registry"), not by which plan phase built them. This plan may reference phases for sequencing; that wording must not leak into shipped artifacts.
- `todo/TODO.md` may only be edited as `[ ]` → `[x]`.
- Every bug found during this migration gets a regression test that fails before the fix. Run focused tests during development and the full suite before finishing. Acceptance per AGENTS.md: purpose clear, follows `RULES.md`, invariants tested, docs accurate, validation passes.

---

## Schema gotchas (learned on this codebase)

- JSON Schema `if/then` with `properties.<field>.enum` is **vacuously true when the field is absent** — a conditional that requires `amount` when `mode` is `random|choose` must ALSO `"required": ["mode"]` inside the `if`, or a bare node wrongly requires `amount` (see the existing `remove_conditions` rules for the correct pattern).
- Hand-rolled recursive structural branches (e.g. `alwaysOnNode`) reject a top-level `raw` — reference `effectNode` via `allOf` + a `type` const instead of restating its properties.
- `additionalProperties: false` is enforced on every node/definition — every new field must be declared, and old fields removed together with their consumers.
- The compiler normalizes human vocab → codes (`normalizeEffectObject`, `normalizeList`, `positionCodeMap`). `kind` values are already lowercase single words (`standard`, `shinheuh`, `landmark`, `conduit`) — normalize with `toCode` for safety; `line` is `frontline`/`backline` verbatim.

---

## Steps (7 phases; `→` = depends on)

1. **Data contract** — `schemas/card.schema.json` + `schemas/compiled-cards.schema.json`: add card-level `kind`, `line`, `rules` (replacing `global_rule` in `modifierNode`); per-`kind` discriminated union; add `kind` + `line` to `unitFilter`/`unitTarget`/`predicateTarget`/`cardTarget`. _(blocks 2–5)_
2. **Compiler + validator** — `scripts/card-compile.js`: drop the `isConduit` dummy + `normalizePositionFilter` shinheuh alias; compile `kind`/`line`/`rules`; `cleanCompiled` sparse-field handling. `scripts/card-validate.js`: replace `isConduit`/`isLandmark`/`positionsRequiringNullRank` with kind-based rules (rank required iff `standard`; abilities/evolve forbidden for `landmark`/`conduit`; evolve forbidden for `shinheuh`; `line` required for `shinheuh`; `unreachable` required for `conduit`). _(→ 1, blocks 3)_
3. **Card + fixture data** — migrate the 9 special cards + 4 referencing cards + fixtures (`landmark_unit`, `shinheuh`, `anima_unit`); `global_rule` → top-level `rules`; shrink `positions.json` to the 5 main positions. Recompile cards + fixtures. _(→ 2, blocks 4/5)_
4. **Runtime model + placement** — `server/game/Card.js`/`Unit.js` expose `kind`/`line`; `placedPositionCode` = main position for standard, `null` otherwise. `LifecycleEngine` landmark-replacement and `UseAbilityAction` shinheuh-slot dispatch on `kind`. `GameState` combat slots = 5 main positions. _(→ 3, blocks 5)_
5. **Targeting + rules** — `TargetResolver.applyFilters`/`resolveExistenceUnits` + `toCardTargetView`/`resolveCardTargets` gain `kind`/`line` filters; new `GlobalRuleRegistry` applies `rules` on the always-on path. _(→ 4)_
6. **Docs + tooling** _(parallel with 5)_ — `RULES.md` (kinds vs positions), `docs/COMPILED_CARD_DSL.md`, the architecture docs, `scripts/card-create.js` templates, `scripts/card-lookup.js` `kind=` field.
7. **Tests** — update position-string test references; add kind/rules/line regression tests; full suite green.

---

## Per-phase handoff notes

### Phase 1 — Data contract

- Entry: none. Files: `schemas/card.schema.json`, `schemas/compiled-cards.schema.json`.
- Model the per-`kind` union on the existing per-`type` `oneOf` pattern (unit/skill/equipment already discriminate). `standard` requires `rank` + `positions` (minItems 1); `shinheuh` requires `line`, forbids `rank`/`positions`/`evolve`; `landmark` forbids `rank`/`positions`/`abilities`/`evolve`, allows `rules` + `passives`; `conduit` forbids `rank`/`positions`/`abilities`/`evolve`, requires `deckConstraints` with `unreachable`.
- Define a `ruleNode` definition (typed per rule) and remove `global_rule` from `modifierNode`'s type enum (keep `modify_targeting` and its own `ignore_taunt`/`untargetable_by` rules — those are unrelated).
- Add `kind` and `line` to `unitTarget`, `unitFilter`, `predicateTarget`, `cardTarget` (both schemas). `line` on a target filter is needed for "frontline Shinheuh" vs "backline Shinheuh" distinctions (Lo Po Bia Ren).
- Exit: schema files internally consistent; nothing else is green yet (see sequencing note).

### Phase 2 — Compiler + validator

- Entry: Phase 1. Files: `scripts/card-compile.js`, `scripts/card-validate.js`.
- Delete `isConduit` in both files and `normalizeCardForSchema`'s dummy injection; delete `positionsRequiringNullRank` and the `isLandmark` ability check; delete `positionCodeMap`'s 3 special entries and `normalizePositionFilter`'s `shinheuh` expansion (target filters now use `kind`/`line`).
- Compile `kind` (via `toCode`), `line` (verbatim), and `rules` (reuse `normalizeEffectObject` recursion; keep the `chosen` position sentinel un-expanded).
- `cleanCompiled`: delete `kind`/`line`/`rules` when absent/inappropriate to keep the sparse compiled schema.
- Keep the `shinheuh` **trigger** matching working: `sunwoo_nare`'s `trigger: { type: summon, source: shinheuh }` keeps its value — the string `shinheuh` equals the kind name, so the runtime matcher (Phase 5) just compares `unit.kind === source`; no schema change needed for the trigger.
- Exit: `npm run validate:cards` behavior unchanged for current cards (phases 1+2 land with 3, so expect transient red).

### Phase 3 — Card + fixture data

- Entry: Phases 1–2. Files: the 9 special cards + `sunwoo_nare`, `lo_po_bia_ren` in `data/cards/units/`; fixtures `landmark_unit.yml`, `shinheuh.yml`, `anima_unit.yml` in `server/game/tests/fixtures/yaml/units/`; `server/data/positions.json`.
- Landmark cards: `kind: landmark`; move `global_rule` passives to a top-level `rules` list (floor_of_death, water_stadium, name_hunt_station); leave triggered passives in place (hell_express, wooden_horse, the_hand_of_arlen); remove the empty `rank:` and `positions: [landmark]`.
- Shinheuh cards: `kind: shinheuh` + `line: frontline`; drop `positions`. Conduit: `kind: conduit`; drop the empty `rank:` and `positions`; keep `unreachable` + passives.
- `sunwoo_nare`: `position: shinheuh` → `kind: shinheuh` (both the `has_unit` predicate target and any target filters). `lo_po_bia_ren`: position filters → `kind: shinheuh` (+ `line: frontline`/`backline` per passive); summon/steal card targets → `kind: shinheuh` (keep `cost`/`random`).
- `positions.json`: delete `frontline-shinheuh`, `backline-shinheuh`, `landmark` — leaving exactly the 5 main positions. NOTE this breaks `FixtureCardAudit.test.js` until fixtures are migrated in the same change.
- Exit: `npm run validate:cards`, `npm run compile:cards`, `npm run compile:fixtures` all pass; `cards.json` + fixture `cards.json` contain zero `frontline-shinheuh`/`backline-shinheuh`/`landmark` position codes and zero `global_rule`.

### Phase 4 — Runtime model + placement

- Entry: Phase 3. Files: `server/game/Card.js`, `server/game/Unit.js`, `server/game/GameState.js`, `server/game/services/LifecycleEngine.js`, `server/game/actions/DeployUnitAction.js`, `server/game/actions/UseAbilityAction.js`, `server/game/handlers/{SummonHandler,StealHandler,SwitchPositionHandler}.js`, `server/game/ModifierStack.js`, `server/game/IdFactory.js`.
- `Card.js`: expose `kind`, `line`, `rules` (compiled data). `Unit.js`: accept and store `line`; `placedPositionCode` = chosen main position for standard, `null` otherwise.
- `LifecycleEngine.deployUnit`: landmark 1-per-player replacement keys off `kind === "landmark"` (not `positionCode === "landmark"`); placement line derives from `unit.line` (standard: `positions[positionCode].line`; shinheuh: authored line; landmark/conduit: `backline`).
- `UseAbilityAction`: `isShinheuh` via `unit.kind === "shinheuh"` (both validate and execute paths).
- `GameState.#initializePlayerState`: `combatSlotCodes` = the 5 main positions (the `!special` filter becomes a no-op once `positions.json` is shrunk — simplify but keep behavior).
- **Open decision:** shinheuh deploy from hand (Bull) — the deploy payload currently carries `placedPositionCode`. For shinheuh, either accept `frontline`/`backline` as the position-code value or add a `line` field; validate by kind. Recommended: keep `placedPositionCode` carrying the line value for shinheuh and store `Unit.line` from it, leaving `placedPositionCode` null on the unit.
- `SummonHandler`/`StealHandler`/`SwitchPositionHandler`: placement must not iterate printed positions for special kinds — resolve the field line from kind/line. `SwitchPosition` naturally excludes special kinds (no printed positions).
- `ModifierStack` `sourceType: "landmark"` and `IdFactory.landmarkSource` should derive from `kind` (or be aligned) — keep the naming convention intact since `ModifierStack` serialization depends on it.
- Exit: runtime deploys/summons a landmark, shinheuh, and standard unit correctly; shinheuh ability use consumes the shinheuh slot.

### Phase 5 — Targeting + rules

- Entry: Phase 4. Files: `server/game/TargetResolver.js`, `server/game/utils/cardData.js`, `server/game/EffectResolver.js`, `server/game/services/ModifierService.js`, new `server/game/services/GlobalRuleRegistry.js` (name TBD), `server/game/services/PassiveManager.js`/`TriggerManager.js` (trigger `source: shinheuh` matching).
- `TargetResolver.applyFilters`: add `filterByKind` and `filterByLine`; keep `filterByPosition` main-only (special kinds have `placedPositionCode: null` and are naturally excluded); `filterByCanSwitch` is standard-only by construction. `resolveExistenceUnits` shares `applyFilters` so it inherits `kind` automatically.
- `toCardTargetView` + `resolveCardTargets`: add `kind`/`line` to the view and filter set (card targets for summon/steal use these instead of position arrays).
- Trigger matching: `trigger.source: shinheuh` (sunwoo_nare) compares against `unit.kind`.
- `GlobalRuleRegistry`: apply landmark `rules` on the always-on path (the eventual home of the current silent `global_rule` skip). Keep parity with today's no-op behavior; full rule semantics can be built out later. **Do not** wire `rules` through `ModifierService.isModifier` (it is not a stat modifier).
- Exit: "steal the enemy's cheapest Shinheuh" and "summon a random 2 cost Shinheuh" resolve via `kind`; landmark rules are registered and revocable by source.

### Phase 6 — Docs + tooling

- Entry: any time after Phase 2 (parallel with 4/5). Files: `RULES.md`, `docs/COMPILED_CARD_DSL.md`, `docs/CARD_AUTHORING.md`, `docs/PASSIVE_SYSTEM_ARCHITECTURE.md`, `docs/TARGETING_ARCHITECTURE.md`, `docs/SERVICE_LAYER_ARCHITECTURE.md`, `docs/GAMESTATE_ARCHITECTURE.md`, `docs/HANDLER_SYSTEM_ARCHITECTURE.md`, `docs/MODIFIER_STACK_ARCHITECTURE.md`, `scripts/card-create.js`, `scripts/card-lookup.js`.
- `RULES.md`: "Positions" → split into main positions + a "Kinds" concept (Landmark / Shinheuh / Conduit are kinds, not positions). Note "Backline: Spear Bearer, Light Bearer, Landmark" — landmark is backline by kind now.
- `COMPILED_CARD_DSL.md`: `kind`, `line`, `rules` grammar; remove `global_rule`; document the `kind`/`line` filter vocabulary; keep the compiled-vocab table current.
- `card-create.js`: unit template gains `kind:`/`line:`/`rules:` (landmark/shinheuh/conduit templates). `card-lookup.js`: add a `kind=` field.
- Architecture docs: update the placement/line contract, the filter vocabulary, and the rules registry in the single owning doc each; do not duplicate.
- Exit: docs describe the target model; no stale references to landmark/shinheuh as positions or to `global_rule`.

### Phase 7 — Tests

- Entry: after 4/5 changes. Files: any test touching `frontline-shinheuh`/`backline-shinheuh`/`landmark` positions — `UseAbilityAction.test.js`, `SummonHandler.test.js`, `StealHandler.test.js`, `SlayHandler.test.js`, `CopyAbilityHandler.test.js`, `SwitchPositionHandler.test.js`, `EffectPrimitivesIntegration.test.js`, `ModifierRuntimeIntegration.test.js`, `AnimaEngine.test.js`, `IdFactory.test.js` (landmarkSource), `FixtureCardAudit.test.js`, plus `tests/utils.js` deploy helper if it hardcodes position codes.
- New regression tests: per-kind validation rejections (rank on shinheuh, abilities on landmark, missing line on shinheuh, missing unreachable on conduit); `kind`/`line` target filters; landmark `rules` apply + revoke; shinheuh slot gated by `kind`; landmark 1-per-player via `kind`; conduit deploys without a position.
- Exit: `npm run test` fully green (baseline entering this migration: 84 suites / ~779 tests).

---

## Relevant files

- Schemas: `schemas/card.schema.json`, `schemas/compiled-cards.schema.json`.
- Scripts: `scripts/card-compile.js` (`compileCard`, `positionCodeMap`, `normalizePositionFilter`, `normalizeEffectObject`, `cleanCompiled`), `scripts/card-validate.js` (`isConduit`, `normalizeCardForSchema`, `positionsRequiringNullRank`, `validateRankAndCost`, `isLandmark` check), `scripts/card-create.js`, `scripts/card-lookup.js`, `scripts/compile-fixtures.js`.
- Data: `server/data/positions.json`, `data/cards/units/{floor_of_death,water_stadium,name_hunt_station,hell_express,the_hand_of_arlen,wooden_horse,bull,stone_doll,conduit,sunwoo_nare,lo_po_bia_ren}.yml`, `server/game/tests/fixtures/yaml/units/{landmark_unit,shinheuh,anima_unit,stone_doll}.yml`.
- Runtime: `server/game/Card.js`, `server/game/Unit.js`, `server/game/GameState.js`, `server/game/TargetResolver.js`, `server/game/EffectResolver.js`, `server/game/utils/cardData.js`, `server/game/ModifierStack.js`, `server/game/IdFactory.js`, `server/game/services/LifecycleEngine.js`, `server/game/services/ModifierService.js`, `server/game/services/PassiveManager.js`, `server/game/services/TriggerManager.js`, `server/game/actions/DeployUnitAction.js`, `server/game/actions/UseAbilityAction.js`, `server/game/actions/SwitchPositionAction.js`, `server/game/handlers/{SummonHandler,StealHandler,SwitchPositionHandler}.js`, new `server/game/services/GlobalRuleRegistry.js`.
- Docs: `RULES.md`, `docs/COMPILED_CARD_DSL.md`, `docs/CARD_AUTHORING.md`, `docs/PASSIVE_SYSTEM_ARCHITECTURE.md`, `docs/TARGETING_ARCHITECTURE.md`, `docs/SERVICE_LAYER_ARCHITECTURE.md`, `docs/GAMESTATE_ARCHITECTURE.md`, `docs/HANDLER_SYSTEM_ARCHITECTURE.md`, `docs/MODIFIER_STACK_ARCHITECTURE.md`.

---

## Verification (definition of done)

1. `npm run validate:cards` — 0 errors; new kind rules enforced (invalid rank/abilities/evolve/line combos rejected).
2. `npm run compile:cards` + `npm run compile:fixtures` — 0 `custom`/`handler`; zero `frontline-shinheuh`/`backline-shinheuh`/`landmark` position codes and zero `global_rule` in `cards.json` or fixture output.
3. `npm run test` — full suite green (baseline 84 suites / ~779 tests) + new kind/rules/line regression tests.
4. Grep empty for the deleted smells: `isConduit`, `positionsRequiringNullRank`, `=== "landmark"` (runtime), `global_rule`, `frontline-shinheuh`/`backline-shinheuh` (runtime + data).

---

## Decisions (locked with the user)

- Default kind name = `standard` (avoids colliding with the `unit` type name; `regular` is already a rank).
- Runtime placement model: first-class `line`; `placedPositionCode` = main position for standard, `null` for special kinds.
- `rules` = always-on battlefield rules only; landmark _triggered_ effects stay in `passives`.
- `kind`/`line` are filter vocabulary in unit + card targets (replaces the `position: shinheuh` alias).
- Frontend deferred (already broken); `JeonsulsaEngine` (Conduit spawn) and full `rules` runtime semantics are out of scope beyond the registry wiring.
- Phases 1–3 land as one atomic unit (schema → compiler/validator → data) because every compile/audit step gates on the others.
