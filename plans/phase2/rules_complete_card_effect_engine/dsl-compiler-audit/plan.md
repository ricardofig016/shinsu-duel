## Plan: DSL, compiler, and audit

### TL;DR

Make the card-data pipeline self-checking instead of relying on several manually maintained lists. Add one machine-readable DSL catalog, keep the two JSON Schemas explicit but test them against that catalog, expose a non-mutating compile-for-audit path, and replace the narrow shipped-card audit with checks for source/artifact parity, stable IDs, recursive node coverage, and runtime ownership. Keep gameplay behavior out of this plan. The audit must report the four currently schema-valid but unregistered effect types precisely, so a later runtime plan cannot mistake schema validity for executable behavior.

## Steps

### 1. Establish the catalog contract

- Add `schemas/dsl-catalog.json` as the canonical list of DSL ownership categories. Include separate lists for dispatchable effect/ability/passive node types, structural resolver types (`sequence`, `conditional`), marker types such as `noop` and `quick`, modifier types, landmark rule types, predicate types, trigger types, and any compiler-only or special node classifications needed by the audit.
- Record enough metadata for the audit to distinguish a node that must be handled by `EffectResolver` structurally from a node that must be registered in `HandlerRegistry`. Do not put card-specific behavior or gameplay semantics in the catalog.
- Include the four known schema-valid but currently unregistered effects in the dispatchable catalog. The catalog is an inventory, not a false claim that those handlers already exist.
- Document the catalog's ownership rule and the source/artifact boundary in the plan's implementation notes or the affected DSL architecture document. The JSON Schemas remain checked-in validation documents rather than generated files.

**Completion criteria:** `schemas/dsl-catalog.json` has one unambiguous entry for every effect, modifier, rule, predicate, and trigger discriminator currently accepted by the schemas, with structural and dispatchable ownership explicit. A test can load it without importing runtime gameplay code.

### 2. Make compiler recognition explicit and reusable

- Update `scripts/card-compile.js` so `compileNode` and recursive normalization validate node ownership against the catalog before schema validation. Unknown node types must fail with a path such as `Card.effects[0].steps[1]`, and the error must identify the unsupported type. Preserve `raw` as display text and never parse it.
- Keep the existing recursive handling for `steps`, nested `effect`/`ability`/`then`/`otherwise`, descriptors, predicates, and triggers, but make the recursive walker use the catalog's node-kind information rather than silently accepting arbitrary `type` strings until Ajv rejects them later. Ensure trigger and predicate types are audited wherever they occur, including nested modifier and passive data.
- Refactor compilation so an in-memory compile result can be requested without writing `server/data/cards.json` or running a subprocess that only prints to the console. Preserve `compileAll()` as the writing command used by `npm run compile:cards`; add a clearly named non-mutating path or option for tests that returns the same final keyed object after source validation, cross-reference resolution, cleaning, and compiled-schema validation.
- Preserve the existing production ID contract: load all YAML, sort by card name with the compiler's defined comparison, assign IDs from that order, resolve evolve/ignite references, clean sparse fields, and key the result by stringified `cardId`. Make duplicate names and duplicate IDs explicit failures instead of allowing one keyed object to overwrite another.

**Completion criteria:** compiler unit tests prove unknown nested node types fail with source context, known structural nodes do not require handlers, known dispatchable nodes remain accepted, and an in-memory compile returns the same normalized artifact that the write path would produce without changing any file.

### 3. Add schema-to-catalog drift checks

- Add test helpers that extract discriminator values from `schemas/card.schema.json` and `schemas/compiled-cards.schema.json`, including effect-node enums, modifier/rule enums, predicate/trigger consts or enums, and any relevant marker restrictions. Compare those sets with the appropriate catalog categories.
- Keep both schemas explicit and readable. Do not introduce schema generation in this work. The tests are the coupling mechanism: a catalog or schema edit that is not reflected in the other contract fails with a useful category and value in the error.
- Check that source and compiled schemas agree on the accepted DSL grammar where they are intended to agree, while allowing only documented source-versus-compiled differences such as keyword shape and compiled normalization. Avoid a brittle full-text schema comparison.
- Add negative cases for a catalog type removed from a schema and a schema type missing from the catalog. The test should make it clear which owner category is stale.

**Completion criteria:** changing any DSL discriminator in either schema without updating the catalog fails the focused catalog-coupling test; a valid synchronized catalog and both schemas pass.

### 4. Replace the narrow production card audit with a complete data audit

- Expand `server/game/tests/integration/CardDataAudit.test.js` into the production-only audit. It must load `data/cards/**/*.yml` as source and `server/data/cards.json` as the generated artifact, using the existing recursive card-file collection and Ajv schema validation.
- Assert source/artifact identity after compilation: every source card has exactly one compiled card, names and IDs are unique, no compiled card is orphaned, all cross-reference IDs point to the expected card, and the keyed artifact matches the compiler's stable name-sorted ID rule.
- Compare the checked-in artifact with a fresh in-memory compilation using canonical semantic JSON comparison. Canonicalize object key order for the comparison, but include all normalized content and IDs. This catches stale fields, stale cross-references, and nondeterministic output while ignoring harmless JSON formatting differences. The audit must not rewrite files.
- Retain the existing checks for compiled-schema validity, no `custom` types, no `handler` fields, and structured YAML top-level entries. Extend recursive extraction to collect all effect, modifier, rule, predicate, trigger, and nested node types from source and compiled forms, rather than inspecting only top-level entries.
- Assert that the production artifact contains no malformed node shapes that a hand-edited JSON file could introduce, including unknown nested types, missing required `raw` fields on top-level entries, and duplicate identity. Report card name/path and node path in failures.
- Keep this audit separate from `server/game/tests/fixtures/FixtureCardAudit.test.js`. Fixtures intentionally exercise schema-edge shapes and are not required to satisfy production card domain validity or production ID allocation. Reuse only neutral walker/canonicalization helpers if that reduces duplication; do not make fixture tests consume the production catalog audit as a validity gate.

**Completion criteria:** `CardDataAudit` fails when the checked-in artifact is stale, a source card is missing/orphaned, IDs or names collide, a nested node is unknown or malformed, or a legacy `custom`/`handler` field appears. A fresh unmodified compile and the current artifact pass.

### 5. Add handler ownership coverage without hiding known gaps

- Expose a test-readable way to inspect the initialized effect registry, or otherwise expose the registered dispatchable effect names without coupling the audit to private map fields. Keep `HandlerRegistry` as the runtime mapping and keep structural resolution in `EffectResolver`.
- Add a coverage assertion that every compiled dispatchable node type is either registered in `HandlerRegistry` or is a catalog-declared special case with an explicit owner. Structural nodes must be proven to be handled by the resolver, not treated as missing handlers.
- Make the current four missing handlers produce a precise coverage report for `grant_affiliation`, `return_to_hand`, `choose_position`, and `play_jeonsul_baang`. This plan does not implement those gameplay handlers. Prefer a failing coverage test, as agreed, so schema acceptance cannot silently imply runtime support. If the repository needs the rest of the suite green before those handlers are planned, isolate this as a clearly named DSL/runtime coverage test rather than weakening the assertion or adding a permanent undeclared allowlist.
- Add coverage for catalog entries that are never used by shipped cards as well as entries that are used. The audit should distinguish an unused but registered node from a used but unregistered node.

**Completion criteria:** the coverage output lists each used dispatchable type and its owner; structural nodes are recognized as resolver-owned; unregistered shipped types fail with exact names and card/node paths; no unknown type is silently classified as supported.

### 6. Audit compiler, runtime, and data catalogs together

- Add focused tests for catalog completeness across compiler recognition, schema acceptance, and runtime ownership. The tests should detect a type accepted by the compiler but absent from both schemas, accepted by a schema but rejected by the compiler, or compiled into shipped data without a resolver/handler owner.
- Audit trigger, modifier, and landmark-rule inventories as data contracts even though this plan does not wire new events or implement new gameplay. For every trigger type found in shipped data, verify that it is represented in the catalog and that the current audit report marks runtime subscription ownership as either implemented or explicitly missing. For modifier and rule types, verify catalog membership and the existing `ModifierService`/`GlobalRuleRegistry` ownership categories where those registries are already available.
- Do not make this plan implement `PassiveManager` trigger mapping, Jeonsulsa behavior, or the four missing effects. Their absence should be visible in audit output and covered by follow-up work, not papered over as a schema/compiler success.

**Completion criteria:** one focused audit report can answer, for each type found in shipped data, whether the compiler recognizes it, the schemas accept it, and the runtime has an owner. Any mismatch fails with a path and category.

### 7. Update the DSL documentation and test instructions

- Update `docs/COMPILED_CARD_DSL.md` to name `schemas/dsl-catalog.json` as the canonical type inventory, explain structural versus dispatchable ownership, and describe the production audit's source/artifact comparison. Correct any wording that says the compiler alone guarantees runtime handler coverage.
- Update `docs/HANDLER_SYSTEM_ARCHITECTURE.md` only for the registry-inspection/ownership contract and the distinction between structural resolver nodes and handler types.
- Update `docs/CARD_AUTHORING.md` if the authoring workflow now depends on the catalog when adding a node type. Keep it as a pointer, not a second grammar reference.
- Update `docs/TESTING.md` with the focused `CardDataAudit` and compiler/catalog test commands, and state that production data audits and fixture audits intentionally enforce different contracts.
- Do not duplicate the full catalog in prose or spread the same contract across multiple docs. Keep gameplay trigger semantics in the trigger architecture document unless the implementation changes its ownership contract.

**Completion criteria:** documentation points agents to the catalog, compiler, schemas, and production audit in the order needed for DSL changes, with no stale claim that every schema-valid type already has a runtime handler.

## Relevant files

- `schemas/dsl-catalog.json` — new canonical machine-readable ownership catalog.
- `schemas/card.schema.json` — explicit source-schema discriminators checked against the catalog.
- `schemas/compiled-cards.schema.json` — explicit compiled-schema discriminators checked against the catalog.
- `scripts/card-compile.js` — catalog-backed recursive node recognition, deterministic in-memory compilation, duplicate identity checks, and the existing artifact writer.
- `scripts/tests/card-compile.test.js` — compiler failures, recursive unknown-node paths, deterministic output, and non-mutating compilation tests.
- `server/game/tests/integration/CardDataAudit.test.js` — production source/artifact parity, recursive inventory, schema/legacy-field checks, and runtime ownership coverage.
- `server/game/tests/fixtures/FixtureCardAudit.test.js` — remains separate for intentionally non-production fixture contracts; reuse neutral helpers only if useful.
- `server/game/EffectResolver.js` — structural node ownership and public registry inspection needed by the audit; do not add gameplay handlers here.
- `server/game/registries/handlerRegistry.js` — registered dispatchable handler names and explicit registry contract.
- `server/game/services/ModifierService.js` — existing modifier ownership used by coverage checks.
- `server/game/services/GlobalRuleRegistry.js` — existing landmark-rule ownership used by coverage checks.
- `server/game/services/PassiveManager.js` — trigger ownership inventory only; do not wire new triggers in this plan.
- `server/game/EventCatalog.js` — canonical event names consulted only to label current trigger ownership, not to add gameplay events.
- `docs/COMPILED_CARD_DSL.md` — catalog, structural/dispatchable split, and audit contract.
- `docs/HANDLER_SYSTEM_ARCHITECTURE.md` — handler versus resolver ownership boundary.
- `docs/CARD_AUTHORING.md` — pointer to the catalog for new DSL types.
- `docs/TESTING.md` — commands and production/fixture audit boundary.
- `package.json` — no new CLI is required; retain existing validation/compile/test scripts unless a test-only helper needs a script entry.

## Verification

Run these from the repository root, in this order:

1. `npm run test -- card-compile` to validate catalog-backed compilation, recursive type errors, deterministic in-memory output, duplicate identity checks, and existing normalization behavior.
2. `npm run test -- CardDataAudit` to validate production YAML/artifact parity, canonical equality, IDs, recursive inventories, schema validity, and legacy-field rejection.
3. Run the catalog/ownership-focused test pattern, including schema drift and handler ownership coverage. The exact filename may be chosen during implementation, but it must be a focused Jest invocation documented in `docs/TESTING.md`.
4. `npm run validate:cards` to prove source YAML remains valid under the source schema and domain rules.
5. `npm run compile:cards` to prove the normal writer still produces a schema-valid artifact. The audit must run against an unchanged working tree after this command.
6. `npm run compile:fixtures` and `npm run test -- FixtureCardAudit` only if neutral helper changes touch fixture compilation/audit. Do not apply production domain validity or production ID assertions to fixtures.
7. `npm run test` for the full suite. The expected result includes the deliberately failing runtime-coverage assertion until a follow-up runtime plan implements the four missing handlers. This red test is intentional and is the acceptance signal that schema-valid shipped effects still lack runtime ownership.

## Decisions

- Scope is limited to DSL, compiler, schemas, catalog coupling, source/artifact auditing, and ownership reporting. It excludes `grant_affiliation`, `return_to_hand`, `choose_position`, `play_jeonsul_baang`, the Jeonsulsa engine, passive-trigger wiring, and the change from unsupported-effect skipping to throwing.
- `schemas/dsl-catalog.json` is the canonical machine-readable inventory with explicit ownership categories. The JSON Schemas remain explicit checked-in files, and focused tests detect drift rather than generating them.
- The audit compares a fresh in-memory compilation to `server/data/cards.json` by canonical semantic equality, including stable card IDs. It ignores only object-key ordering and formatting. The audit never rewrites the artifact.
- Production cards and intentionally non-production fixtures have separate audits. Fixture schema validity and fixture-specific ID/name conventions remain in `FixtureCardAudit.test.js`.
- Runtime coverage is a required report and a failing assertion for used unregistered dispatchable types. The four current gaps are named, not hidden behind an undeclared or permanent pass list.
- `raw` remains display-only. No compiler or audit path may parse card prose to infer behavior.
- The catalog records ownership and accepted type inventory, not the full gameplay semantics of each effect. Runtime behavior remains owned by the existing resolver, handlers, services, modifier registry, and rule registry.

## Further Considerations

- The runtime coverage test is expected to fail until the later gameplay plan adds the four missing handlers. If the user wants the DSL/compiler/audit plan itself to land with a green full suite, choose whether the coverage assertion should be a separately invoked acceptance test or whether implementation should be bundled with those handlers. The recommended choice is to keep the assertion strict and explicitly separate the known runtime work rather than weakening the audit.
