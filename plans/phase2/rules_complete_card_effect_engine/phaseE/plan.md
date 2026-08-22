## Plan: Phase E — New effect primitives

**TL;DR** — Add 13 handlers (one per DSL `type`) plus 4 `LifecycleEngine`/`ZoneService` methods, a `source`-descriptor resolution branch in `EffectResolver`, 4 events, and a `repeat_play` queue. Reuse `DealDamageHandler`'s death tail via a shared `LifecycleEngine.killUnit`; reuse `transformUnit` for transform/revert and `detachEquipment` for disarm.

### Steps

**Phase E.1 — Lifecycle (`slay`, `transform`)** _(parallel with E.3)_

1. `LifecycleEngine.killUnit(gameState, unit, {sourceId, sourceOwner, context})` — emits `UNIT_DEATH_INTENT` (Undying can cancel) → `UNIT_KILLED` (sourceId/killerId = slayer) → `destroyUnit`. Refactor `DealDamageHandler`'s inline tail to call it (no behavior change).
2. `SlayHandler` — validate `targetId`, call `killUnit`; returns `{slayed, undyingSaved}`.
3. `TransformHandler` — resolve `cardName` via `findCardsByName(..., "unit")`, call `LifecycleEngine.transformUnit(gameState, sourceUnit, targetCardId)`.
4. Tests: `SlayHandler.test.js`, `TransformHandler.test.js`.

**Phase E.2 — Zone movement (`summon`, `steal`, `discard`, `disarm`, `switch_position`)** _(depends on E.1; parallel with E.3)_

1. `LifecycleEngine.summonUnit` — shared "place unit" tail (traits/index/passives/attributes/`UNIT_DEPLOYED`+`UNIT_SUMMONED`); no cost/turn/slot; same-name copy → `ZoneService.discard`.
2. `SummonHandler` — resolve `from` (deck/hand/deck_or_hand/game) + `card` candidates; `onto` self/opponent/both; player position choice + overflow decision.
3. `StealHandler` — translate `card` descriptor into a unit filter, reassign `unit.owner`, auto-assign legal position, re-index, emit `UNIT_STOLEN`.
4. `DiscardHandler` — resolve card target (default zone hand, or `equipment` for bearer attachments); new `ZoneService.removeFromHandById`; emit `CARD_DISCARDED`.
5. `DisarmHandler` — `detachEquipment` then route by `to` (hand → owner, discard → you); emit `EQUIPMENT_DETACHED`.
6. `SwitchPositionHandler` — position choice among target's other printed positions, excluding full lines; Rooted check; `switchPosition` + `UNIT_POSITION_SWITCHED`.
7. Tests: one per handler, incl. full-line/single-position guards.

**Phase E.3 — Unit state (`remove_traits`, `copy_traits`, `grant_random_trait`, `peek_hand`)** _(parallel with E.1/E.2)_

1. `RemoveTraitsHandler` — `removeWhere` trait modifiers (REMOVE, per RULES "at the moment applied"); emit `UNIT_SILENCED`.
2. `CopyTraitsHandler` — copy source unit's active trait keys+values onto target (needs source resolution from E.4).
3. `GrantRandomTraitHandler` — seeded-random trait from `traits.json` (filter `numeric`), grant via modifier stack.
4. `PeekHandHandler` — observer-only; `card` filter + `mode` (all/random/choose) + `amount` + `random`; emit `HAND_PEEKED`; no mutation.
5. Tests: one per handler.

**Phase E.4 — Abilities (`copy_ability`, `repeat_play`) + source resolution** _(depends on E.1)_

1. `EffectResolver` — add a `source` descriptor resolution branch (for `copy_traits`/`copy_ability`) producing a concrete `sourceUnit`.
2. `CopyAbilityHandler` — two decisions (choose enemy → choose one of its abilities), resolve copied ability via `resolveEffect` (no extra slot/turn).
3. `RepeatPlayHandler` — per-player pending-repeat state on `GameState` (serialized), consumed by `PlaySkillAction` on next plays (Cluster T). `cardName` is optional: omitted, the repeat is a wildcard ("the next card you play, play it again").
4. Tests: `CopyAbilityHandler.test.js`, `RepeatPlayHandler.test.js`.

**Phase E.5 — Wiring + events + docs + full suite** _(depends on E.1–E.4)_

1. `EventCatalog`: `CARD_DISCARDED`, `UNIT_STOLEN`, `UNIT_SILENCED`, `HAND_PEEKED`.
2. `EffectResolver.getRegistry`: register all 13 handlers; add `discard` → hand zone default.
3. `RULES.md`: add **Steal** keyword.
4. Incremental docs (`HANDLER_SYSTEM`, `COMPILED_CARD_DSL`, `SERVICE_LAYER`, `EVENT_BUS`); mark Phase E done in `plan.md`.
5. Full suite via `npm run test` (never bare jest).

### Relevant files

- `EffectResolver.js` — register handlers, `source` resolution, discard zone default
- `LifecycleEngine.js` — `killUnit`, `summonUnit`, `stealUnit`
- `ZoneService.js` — `removeFromHandById`
- `server/game/handlers/*.js` — 13 new handler files
- `EventCatalog.js`, `GameState.js` (repeat_play state), `PlaySkillAction.js` + `DeployUnitAction.js`
- `RULES.md`, `schemas/*.schema.json`, `data/cards/equipments/*thorn_fragment*.yml`, `server/game/tests/handlers/*.test.js`

### Verification

1. `npm run test` full suite green.
2. One handler test per new handler (validate + execute + edge cases).
3. Integration: Khun Ran revert, Narumada ignition-via-slay, Lo Po Bia Ren summon+steal, Thorn Fragment discard → Enryu's Thorn, Jyu Viole Grace copy_ability, Monkeyman peek_hand, Evan Edrok forced switch (full-line guard).
4. Seeded determinism for random summon/steal/grant_random_trait/peek_hand.
5. `npm run compile:cards` + `npm run validate:cards` if schema/YAML change.

### Decisions

- `slay` → shared `killUnit` death tail (Undying + kill triggers both fire).
- `steal` → unit control transfer (only current `steal` card is a unit; equipment-steal is future).
- `disarm` reuses `detachEquipment`; `to` routes the destination.
- `remove_traits` REMOVES trait modifiers (not disable).
- `repeat_play` with no `cardName` queues a wildcard repeat — the player's next card play is replayed (future-proofs "play it again" effects).

### Further Considerations

- extend the zone enum to `"attachments"` (bearer attachments) + adding `zone: attachments` to the 4 thorn-fragment discard nodes + migrating has_all_equipped's cardNames to thorn-fragment series
- **`copy_ability`** should not spend the caster's combat slot or end the turn (the parent `spend_shinsu` ability governs it).
- **`steal` into a full destination line** should reuse the same overflow decision as summon
- Jyu Viole Grace's "Silence an enemy that has at least one passive" ability is wrong, missing the "at least one passive" check

The plan is persisted at `/memories/session/plan.md`. Want me to adjust anything based on the three considerations, or is this ready for handoff?
