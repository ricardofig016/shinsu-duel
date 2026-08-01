# Shinsu Duel Resurrection Plan

This document is the implementation contract for rebuilding the game engine without discarding the working server, client, card data, or tests.

## Current status

| Phase                            | Status      | Scope                                                                       |
| -------------------------------- | ----------- | --------------------------------------------------------------------------- |
| 0 — Foundation and data pipeline | Complete    | Source validation, compilation, runtime card contract, rules/data alignment |
| 1 — EventBus                     | In progress | Mutation-capable event pipeline, tests, and validator tests                 |
| 2 — GameState                    | Not started | Rules-complete authoritative game state                                     |
| 3 — Actions                      | Not started | Complete player action model                                                |
| 4 — Effects and passives         | Not started | Generic DSL execution and custom handlers                                   |
| 5 — Integration testing          | Not started | Cross-system and regression coverage                                        |
| 6 — WebSocket and client         | Not started | Client protocol and UI integration                                          |

## Cross-phase contracts

These rules apply to every phase:

1. `RULES.md` is the authority for gameplay vocabulary and mechanics.
2. YAML files in `data/cards/` are the card source of truth. Do not edit `server/data/cards.json` by hand.
3. Frontline and backline Shinheuh are special positions sharing the `shinheuh` combat-slot group.
4. Card text uses canonical vocabulary. Do not add aliases to the compiler to accommodate non-canonical source text; correct the source card instead.
5. Source text is preserved in compiled `raw` fields. Parsed metadata and structured fields are additional data, not replacements for source text.
6. Evolution and ignition are optional. An empty or omitted trigger means no transformation; a non-empty trigger requires an exact target card of the appropriate type.
7. `scripts/card-validate.js` validates source YAML only. `scripts/card-compile.js` invokes it before compilation and validates the generated JSON separately.
8. Keep `server/data/cards.json` present and regenerated because the server consumes it at runtime.
9. Never under any circumstances sacrifice good architecture and cleanliness for backwards compatability and legacy implementation. The plan is to rewrite the game engine, not to patch it up.

## Phase 0 — Foundation and data pipeline

**Goal:** stabilize the authoring contract and produce validated runtime card data before changing game logic.

### Source layout

- `data/cards/*.yml`: human-authored source cards.
- `schemas/card.schema.json`: source YAML schema.
- `scripts/card-validate.js`: YAML parser, schema validator, rules/data validator, and transformation cross-reference validator.
- `scripts/card-compile.js`: pre-validates YAML, compiles cards, computes stable IDs and links, checks icons, validates generated JSON, and writes `server/data/cards.json`.
- `schemas/compiled-cards.schema.json`: generated JSON schema.
- `server/data/cards.json`: generated runtime artifact; it must remain in the repository.

### Source-card contract

Each source card has `type`, `name`, `cost`, and type-specific fields:

- **Unit:** `hp`, `rank`, `positions`, `passives`, `abilities`, `traits`, `attributes`, `affiliations`; `evolve` is optional.
- **Skill:** `requirements` and non-empty `effects`.
- **Equipment:** `requirements`, non-empty `effects`; `ignition` is optional.

Null YAML arrays are normalized to empty arrays for validation and compilation. Empty `evolve`/`ignition` means that no transformation exists. A non-empty unit evolution trigger targets exactly `<name> (evolved)`; a non-empty equipment ignition trigger targets exactly `<name> (ignited)`. Targets must exist and have the expected type.

The validator also checks:

- YAML syntax and schema shape.
- Card filename/name consistency as a warning.
- Position vocabulary and special-position exclusivity.
- Rank/cost ranges.
- Trait, attribute, affiliation, and duplicate-value rules.
- Evolution and ignition target existence/type.

### Compiled-card contract

The compiler assigns stable alphabetical `cardId` values and emits a sparse representation:

- Units contain unit fields, `abilities`, `passives`, and `deckConstraints`.
- Skills and equipment contain `requirements`, `effects`, and `deckConstraints`.
- Equipment may contain `igniteInto`/`ignitedFrom`; units may contain `evolveInto`/`evolvedFrom`.
- `abilities`, `passives`, effects, and transformation triggers use DSL objects.
- Recognized common patterns become structured objects such as `deal_damage`, `give_condition`, `heal`, `create_lighthouse`, `compress_shinsu`, and `spend_shinsu`.
- Unsupported mechanics remain `{ type: "custom", raw, handler }` for a later custom handler.
- Every DSL object preserves the source text in `raw`.
- `Unreachable` also creates `{ type: "unreachable" }` in `deckConstraints`.

The compiler is a finite pattern matcher, not an NLP system. It must not silently reinterpret non-canonical aliases. When a pattern is not supported, preserve it as custom text and add execution support in a later phase.

### Phase 0 checklist

- [x] Keep all card YAML in `data/cards/`, including test cards.
- [x] Add direct `ajv` and `dotenv` dependencies and require Node 20+.
- [x] Add source and compiled schemas with separate roles.
- [x] Validate source YAML before compilation.
- [x] Validate generated JSON after compilation.
- [x] Keep `server/data/cards.json` generated and present.
- [x] Correct Wave Controller metadata to frontline.
- [x] Keep test cards in the production source set.
- [x] Add optional evolution/ignition target checks.
- [x] Preserve raw source card text in compiled DSL entries.
- [x] Normalize card wording to canonical vocabulary without aliases.
- [x] Cross-check `server/data/*.json` metadata against `RULES.md` and remove stale annotations.
- [x] Update icon inventory (`ICONS_TODO.md`) for current positions, including the Shinheuh combat-slot icon.
- [x] Defer remaining custom-effect patterns to Phase 4; current simple-effect parser coverage is sufficient for Phase 0.

### Phase 0 verification

Run these commands before starting Phase 1:

```powershell
npm run validate:cards
npm run compile:cards
npm test -- --runInBand
```

Phase 0 is complete when all three commands pass, generated data is current, and this document accurately describes the contracts above. The card total is reported by the commands and is not a contractual constant.

## Phase 1 — EventBus redesign

**Goal:** make event delivery deterministic and mutation-capable without changing gameplay rules yet.

### Required behavior

`EventBus` must support:

- Dynamic event names; no hardcoded `VALID_EVENTS` allow-list.
- `on(eventName, handler, { phase, priority })` and `once(...)`.
- `off(eventName, handler)`, returned unsubscribe functions, and `removeAllListeners(eventName)`.
- Four phases: `pre`, `execute`, `post`, and `resolved`.
- Stable ordering by phase, priority, then registration order.
- Payload mutation in `pre`/`execute`; cancellation through an event context or result.
- Handler errors that identify the event and do not hide the original error.
- Backward-compatible `subscribe`, `unsubscribe`, and `publish` adapters until callers are migrated.

`Logger` should subscribe in `post` or `resolved`, use safe structured payload copies, and not depend on a removed event list.

### Phase 1 checklist

- [x] Rewrite `server/game/EventBus.js`.
- [x] Update `server/game/Logger.js`.
- [x] Preserve existing callers through `subscribe`/`publish` compatibility adapters.
- [x] Add EventBus tests for pub/sub, ordering, mutation, cancellation, once, unsubscribe, and cleanup.
- [x] Run the full Jest suite.
- [ ] Add focused validator tests for malformed source, invalid vocabulary, and broken transformations (moved from Phase 0).

Phase 1 implementation is complete for the current compatibility scope. A later Phase 2/3 migration may replace legacy `publish` calls with explicit phase-aware `emit` calls when game-state mutation is redesigned.

## Phase 2 — GameState rewrite

Build the authoritative rules model incrementally:

1. Round, turn, shinsu, recharge, lighthouses, draw, and loss conditions.
2. Frontline/backline deployment and position combat-slot groups.
3. Unit, skill, and equipment lifecycle.
4. Traits, conditions, attributes, evolution, and ignition.
5. State serialization and server-safe views.

Each sub-step requires focused tests before the next sub-step.

## Phase 3 — Action system

Implement and test the complete action registry:

- Play a card.
- Deploy a unit.
- Use an ability.
- Play a skill.
- Equip equipment.
- Switch a unit's position.
- Pass.
- Add/destroy lighthouses where rules permit.

Actions validate actor, turn, cost, target, position, combat slot, and resulting state before mutation.

## Phase 4 — Effects and passives

Build the generic DSL interpreter for structured effects and a registry for custom handlers. Support composition, targets, conditions, traits, costs, delayed triggers, and cleanup. Custom handlers are required for genuinely unique mechanics; they must not be hidden in compiler aliases. This phase also handles all `{ type: "custom" }` entries produced by the Phase 0 compiler that were not covered by the baseline simple-effect patterns.

## Phase 5 — Integration testing

Add tests for complete rounds, combat and targeting restrictions, card lifecycle, transformations, effect ordering, deck constraints, WebSocket payloads, and malformed input. Keep test fixtures in `data/cards/` and ensure compilation includes them unless the source-set contract changes explicitly.

## Phase 6 — WebSocket and client

Update the Socket.IO protocol and UI only after the authoritative engine contracts are stable. Maintain sanitized state output, reconnect behavior, room lifecycle, and client rendering for positions, traits, conditions, abilities, and effects.

## Definition of done

A phase is complete only when:

- Its checklist is complete.
- Focused tests and the full Jest suite pass.
- Generated card data is regenerated when source or compiler behavior changes.
- Documentation describes actual code, paths, and contracts.
- No fixed card-count claims or stale `docs/cards`, `docs/scripts`, or deleted-schema instructions remain.
