## Plan: Phase F — Modifier system runtime

**TL;DR** — Bring the already-landed modifier grammar (`modify_stat`/`modify_cost`/`modify_condition`/`modify_keyword`/`modify_targeting`/`modify_repeat`/`retain_equipment`) to runtime, plus a new generic `modify_ability` node and the in-scope trigger cards (`skill_played`/`quick_ability_used`/`deal_damage`). Always-on modifier passives and equipment modifier effects apply as source-tracked ModifierStack entries (revoke-safe, re-evaluated on the same event set as always-on `conditional`s), and every damage/heal/cost/targeting/condition/keyword/repeat consultation point reads the stack.

**Confirmed decisions**

- `modify_repeat` (Phobos) resolves the ability's effect list `amount` times per use (stacks with turn-scoped `repeat_play`).
- `modify_stat {stat: hp}` raises **both** current and max HP (Last One Standing precedent); revoke lowers both (clamped).
- Phase F includes the trigger-based cards.
- Cost modifiers = `stat:cost` entries + a consultation helper.
- **`type: attack` is removed from the grammar** — Ice Spear / Lo Po Bia Ren re-authored as `modify_ability`.
- New **generic `modify_ability { target, effect, position?, if? }`** node (not condition-specific).

**Steps**

_Phase F-1 — vocabulary & stack encoding_ (foundation)

1. Extend `ModifierStack.apply()` to store `when`/`source`/`side`/`filters` metadata; add types `stat`, `keyword`, `ability-augment`.
2. Add filter-aware consultation helpers on `ModifierStack` (`getDamageDealt`, `getHealModifier`, `getDamageTaken`, `getConditionAmplifier`, `hasKeyword`, `getFirstKeyword`, `getTargetingRules`, `getRepeat`, `hasRetainEquipment`, `getAbilityAugments`).

_Phase F-2 — modifier application_ (depends on F-1) 3. New `ModifierService.applyModifier` (evaluate `if`, resolve `target`→all matches, apply source-keyed entries) + `revokeBySource`. 4. `PassiveManager` routes trigger-less `modify_*`/`retain_equipment` through the always-on re-eval path. 5. `LifecycleEngine._resolveEquipmentEffects` dispatches modifier / effect / triggered-effect nodes (new equipment-trigger path).

_Phase F-3 — consultation wiring_ (depends on F-1/F-2) 6. `DealDamageHandler`/`HealHandler` damage & heal amplifiers + `damage_taken` `source` filter. 7. Cost helper `getEffectiveCost` wired into all four actions (validate + execute). 8. `UseAbilityAction`: `modify_keyword` quick/free + `first`-per-round (`_abilitiesUsedThisRound`), `modify_repeat` ×`amount`. 9. `TargetResolver`: `ignore_taunt` + `untargetable_by`. 10. `GiveConditionHandler`: `modify_condition` amplification. 11. `modify_ability` augments resolved against the ability's targets (recursion-guarded).

_Phase F-4 — trigger wiring_ (parallel with F-3) 12. `PassiveManager._parseTrigger`: `skill_played`, `deal_damage`, `quick_ability_used`. 13. `quick` flag on `UNIT_ABILITY_USED` (or new event) for Wooden Horse. 14. Equipment triggered effects (Narumada-Ignited) via the F-2 step-5 path.

_Phase F-5 — grammar & cards_ (atomic with F-2/F-4) 15. Remove `attack` from both schema trigger enums + docs. 16. Add `modify_ability` to both `modifierNode` schemas + docs. 17. Re-author `ice_spear.yml` and `lo_po_bia_ren.yml` (drop `attack`, use `modify_ability`). 18. `validate:cards` + `compile:cards`; commit regenerated `cards.json`.

_Phase F-6 — tests & docs_ 19. Unit + handler/action + `PassiveManager` + integration tests per cluster (B, I, V, F + trigger cards). 20. Update the six architecture docs. 21. Full `npm run test` + determinism.

**Verification** — focused Jest per sub-phase; `npm run validate:cards`/`compile:cards`; one integration test per cluster (Enryu's Thorn HP, Karaka Quick + Edin Dan `first`, Phobos double-resolve, Pedro +2 Poisoned, Yeon Yihwa `untargetable_by`, Stone Doll `damage_taken`, Hwa Ryun +1 / Yeo Goseng −1 cost); replay/determinism test for repeat + random.

**Further considerations**

1. `retain_equipment` (Beta) is registered + helper now, but its consumer (`return_to_hand`, Phase J) stays out of scope — no behavior change until Phase J.
2. The `modify_ability` hook seam (EffectResolver per-target vs UseAbilityAction wrapper) is the trickiest integration point — I recommend hooking `EffectResolver`'s ability-originated target resolution with a recursion guard, flagged for review.

The full plan is persisted at `/memories/session/plan.md`. Note that one subtlety surfaced during research worth your attention: the modifier `target` field carries **three different meanings** by type — attachment target (`modify_stat` damage/heal/hp, `modify_keyword`, `modify_repeat`, `modify_ability`), a victim filter (`modify_condition`), and a blocked-actor filter (`modify_targeting` untargetable_by) — which I've encoded explicitly in `ModifierService.applyModifier`. Let me know if you'd like to revise any step, the phase ordering, or the `modify_ability` hook approach before handoff.
