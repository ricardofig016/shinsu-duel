## Plan: Phase B — Compiler revamp & full DSL migration

**TL;DR** — Phase A closed the schemas (structured-only, no `custom`/`handler`), but the repo is mid-transition: all 82 YAML files are still prose, the compiler still regex-parses into `custom` nodes, and `cards.json` still emits 123 customs + `handler` fields that now **violate the closed compiled schema** (compile/validate currently fail). Per your decisions, Phase B rewrites the pipeline to be structured-only, migrates **all 82 YAML files** (full migration, atomic landing), adds a transitional runtime skip so migrated-but-unimplemented types don't crash, extends the catalog (`noop`, `repeat_play`, `free`, `skill_played`, `keywords`), and lands the invariant: **zero `custom` in `cards.json`**.

**Steps**

_Phase B1 — Schema + DSL contract updates_ (done)

1. Add to `card.schema.json` + `compiled-cards.schema.json`: `keywords` (card-level, all 3 types), `deckConstraints` (source-level; compiled already has it), `noop` + `repeat_play {amount, cardName?}` in the effectNode enum, `free` boolean in effectNode props, `skill_played {cardName}` in the trigger enum.
2. Update `COMPILED_CARD_DSL.md`: keywords field, deckConstraints authoring, new node/trigger types, transitional unregistered-skip note.

_Phase B2 — Compiler revamp_ _(depends on B1)_ (done)

3. Rewrite `card-compile.js` — **delete** `parseEffectText`, `parseEffectWithMetadata`, `dslObject` fallback, regex paths in `compileEffects`/`compileAbility`/`compilePassive`, `isUnreachableKeyword`. **Add** a recursive structured-node validator + normalizer (handles `sequence.steps`, `spend_shinsu.effect`, `grant_ability.ability`, `conditional.then/otherwise`), fail-fast descriptive errors, `raw` preservation, code normalization (position/attribute/affiliation/trait/condition → codes), `deckConstraints` hoisting, `keywords`/`quick`/`free`/`position`/`trigger` passthrough. **Keep** `parseTrigger` (evolve/ignite), cross-ref resolution, name sort + cardId assignment, `cleanCompiled`, `checkIcons`, end-of-pipeline compiled-schema validation.
4. Update `card-validate.js` (schema-driven; keep rank/cost/position/trait/affiliation domain rules; validate `deckConstraints`/`keywords`) and `card-create.js` templates (structured scaffolds).

_Phase B3 — Runtime transitional_ _(parallel with B2)_ (done)

5. `EffectResolver.js`: replace the `type === "custom"` skip with `!registry.has(type)` → skip + emit `EFFECT_UNSUPPORTED` (no throw). Phase J later flips this to throw.
6. `PassiveManager.js`: `_parseTrigger` reads structured `passive.trigger.type` (`round_start`→`ROUND_START`, `round_end`→`ROUND_END`); unknown triggers / modifiers / no-trigger → `null` (transitional skip).
7. New `server/game/handlers/NoopHandler.js` + registry registration for `noop`; `Card.js` gains `this.keywords = cardData.keywords || []`.

_Phase B4 — Full YAML migration (all 82 files; atomic, single landing)_ _(depends on B2)_ (done)

8. Batch 1 (A1–A4): `unreachable` → top-level `deckConstraints` only (drop the duplicated `handler` effect); `Quick` marker → `quick: true` on the real effect; "i am a Jeonsul Baang" → `keywords: [jeonsul-baang]`; `_test_*` → `{type: noop, raw: "test"}`.
9. Batch 2 (C, D, E, J): compound deal+condition chains → `sequence`; heal+cleanse; simple condition grants; draw/reclaim/create with cost gating (Incinerate "create me" → `deckConstraints: [{type: generated_by, ...}]`).
10. Batch 3 (F, X, Y, Z, V): passive triggers → structured trigger objects (attack/summon/draw/equip/quick_ability_used).
11. Batch 4 (B, I, G, O, K, L, M, R, S, U): stat/cost modifiers, affiliation/name targets, trait copy/random/remove, slay, summon, steal/discard/disarm, switch_position, silence, peek_hand.
12. Batch 5 (N, H, W): global rules, conditional selection (`started_with_card`), free/spend sequences.
13. Batch 6 (P, Q, T): Conduit passives (`round_start_or_activation`, `conditional`+`slay`, `play_jeonsul_baang` per-HP), `repeat_play` for Twenty-Fifth Baam - Evolved.
14. Invariant: recompiled `cards.json` has **zero `type: "custom"`**.

_Phase B5 — Tests & docs_ _(depends on B3+B4)_

15. New tests: compiler node validation/normalization/fail-fast/hoisting, audit test (zero `custom` outside allowlist), EffectResolver unregistered-skip, PassiveManager structured triggers, NoopHandler. Update tests touching `custom`/`handler` (e.g. `PassiveManager.test.js:69`, IdFactory fallback).
16. Docs: `HANDLER_SYSTEM_ARCHITECTURE.md` (custom removal, new handlers), `SERVICE_LAYER_ARCHITECTURE.md` (PassiveManager), `TARGETING_ARCHITECTURE.md` if needed.

**Relevant files**

- `card-compile.js` — regex matcher → structured validator/normalizer
- `card.schema.json`, `compiled-cards.schema.json` — keywords/deckConstraints/noop/repeat_play/free/skill_played
- `data/cards/**/*.yml` — all 82 files migrated
- `EffectResolver.js`, `PassiveManager.js`, `server/game/handlers/NoopHandler.js`, `handlerRegistry.js`, `Card.js`
- `COMPILED_CARD_DSL.md`, `HANDLER_SYSTEM_ARCHITECTURE.md`

**Verification**

1. Per-batch YAML review + ajv spot-checks during migration (compile is only runnable after the full atomic landing, since the new compiler rejects prose).
2. `npm run compile:cards` + `npm run validate:cards` after B4 — audit test asserts zero `custom`.
3. Full suite via `node --experimental-vm-modules node_modules/jest/bin/jest.js` (bare `npx jest` breaks ESM); coverage ~97% maintained.
4. Determinism: cardId stability (names unchanged, `_test` cards kept), Hwayeomsa/Incinerate integration green.

**Decisions**

- Full migration now; no dual paths; closed schemas honored; zero customs immediately.
- `keywords` field for identity markers (decision 2); `noop` nodes for test placeholders (decision 3); top-level `deckConstraints` (decision 4); catalog extended now with runtime landing later (decision 5).
- `RULES.md` untouched. Migration is atomic — no partial-compile checkpoint is possible.

**Further Considerations**

1. **`raw` as the display contract** — after migration, `raw` is never parsed; all YAML authors must write structured nodes. The compiler's fail-fast errors should include card name + field path to make this authorable.
2. **`card-lookup.js`** reads YAML — verify substring searches still work on structured YAML (raw text is still present, so likely fine).
3. **Transitional runtime fidelity** — between Phase B and Phases C–I, migrated cards' unimplemented effects silently skip with `EFFECT_UNSUPPORTED` warnings (same observable behavior as today's `custom` skip). Phase J converts skip→throw and removes the final vestiges.
