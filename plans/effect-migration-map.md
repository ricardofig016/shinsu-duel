# Effect Migration Map

Historical inventory and classification of the legacy `type: "custom"` effects in the pre-migration `server/data/cards.json`, with the target DSL node for each. All 82 YAML source cards have now been migrated; this remains the Phase B audit artifact and maps each cluster to the structured grammar in [`docs/COMPILED_CARD_DSL.md`](../docs/COMPILED_CARD_DSL.md). The checked-in `cards.json` has been regenerated with zero `custom`/`handler` entries.

> Counts below refer to the compiled file at the time of the Phase 2 audit (123 `"type": "custom"` occurrences). Some customs are nested inside `spend_shinsu.effect` or `grant_ability.ability`.

## Cluster → target DSL

| #   | Cluster                 | Cards (name, id)                                                                                                                                      | Target DSL                                                                                                       |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| A1  | Unreachable marker (13) | Conduit 11, Enryu's Thorn 13, Fire Core 17, First/Second/Third/Fourth Thorn Fragment 18/58/67/21, Incinerate I–IV 31–34, Shinwonryu 59, Stone Doll 62 | `deckConstraints: [{ type: "unreachable" }]` only — remove the duplicated `handler: "UnreachableKeyword"` effect |
| A2  | Quick-only (5)          | Enna Core 12, Thorn Fragments 18/58/67/21                                                                                                             | entry flag `quick: true` on the real effect (drop the empty `custom` effect)                                     |
| A3  | Identity markers (3)    | Lightning/Static/Thunder Baang 45/60/68                                                                                                               | card data (affiliation/attribute), not an effect                                                                 |
| A4  | Test placeholders (2)   | `_test_Equipment` 2, `_test_Skill` 3                                                                                                                  | structured no-op node in the allowlist, or remove from the production set                                        |

| #   | Cluster                             | Cards (name, id)                                                                                                                                   | Target DSL                                                                                              |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| B   | Bearer/self stat amplifiers (13)    | Enryu's Thorn 13, Thorn Fragments 18/58/67, Narumada 49/50, Ja Wangnan 35, Stone Doll 62, Steel Tree 61, Woon's Hammer 75, Khun A. A. - Evolved 41 | `modify_stat` (damage/heal/hp), `grant_trait` (Immune/Pierce/Strong), `modify_targeting` (ignore_taunt) |
| C   | Multi-target damage + condition (7) | Incinerate II–IV 32/33/34, Ja Wangnan 35, Karaka 37/38, Khun Ran - Evolved 43                                                                      | `sequence` of `deal_damage` (target.count) + `give_condition`                                           |
| D   | Compound heal + cleanse (2)         | Blue Thryssa 7, Healing Flames 24                                                                                                                  | `sequence` of `heal` + `cleanse`                                                                        |
| E   | Simple condition grants (6)         | Conduit 11, Kurudan 44, Redan 57, Shinwonryu 59, Sunwoo Nare 64, Yeon Yihwa 79                                                                     | `give_condition` (with `conditional` gate where needed)                                                 |
| F   | Condition-giving synergies (6)      | Ice Spear 30, Lo Po Bia Ren 46, Pedro 51, Quaetro Blitz 53, Yu Han Sung 80                                                                         | passive `trigger: attack` → `give_condition`, or `modify_*` with `if` predicate                         |
| G   | Trait/stat grants (10)              | Chang Blarode 9, Flower of Zygaena 20, Ha Yuri Zahard 23, Hon Akraptor 27, Urek Mazino 71, Yeo Miseng 77, Yeon Woon 78, Yuga 81                    | `grant_trait` / `modify_stat` with affiliation/name target filters + `conditional` gate                 |
| H   | Conditional effect selection (2)    | Baang 6, Karaka's Armor Suit 39                                                                                                                    | `conditional` (if/then/otherwise); `started_with_card` predicate for 39                                 |

| #   | Cluster                             | Cards (name, id)                                                                                    | Target DSL                                                                                                             |
| --- | ----------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| I   | Cost manipulation (3)               | Hwa Ryun 29, Kurudan 44, Yeo Goseng 76                                                              | `modify_stat { stat: cost }` (with predicate)                                                                          |
| J   | Card creation / draw / reclaim (11) | Akryung 5, Enna Core 12, Evan Edrok 14, Incinerate I–IV 31–34, Twenty-Fifth Baam 69, Yu Han Sung 80 | `create_card` (name/selector + cost gate), `draw_card` (card filter), `reclaim_cards`, `deckConstraints: generated_by` |
| K   | Slay (3)                            | Evankhell 15, Conduit 11, Submerged Fish 63                                                         | `slay` (target filter by condition/rank)                                                                               |
| L   | Summon (4)                          | Lo Po Bia Ren 46, Rachel 54, The Hand of Arlen 65, Yuga 81                                          | `summon` (deck/hand source, cost filter, onto both)                                                                    |
| M   | Steal / discard / Disarm (3)        | Hwa Ryun 29, Lo Po Bia Ren 46, Kurudan 44                                                           | `discard`, `steal`, `disarm`                                                                                           |
| N   | Global board rules (5)              | Floor of Death 19, Hell Express 26, Name Hunt Station 48, Water Stadium 72, Yeon Yihwa 79           | landmark `rules` + `modify_targeting` (79)                                                                             |

| #   | Cluster                             | Cards (name, id)                                   | Target DSL                                                                                   |
| --- | ----------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| O   | Trait copy / random / loss (3)      | Akryung 5, Rachel 54, Yeo Miseng 77                | `copy_traits`, `grant_random_trait`, `remove_traits`                                         |
| P   | Jeonsul Baang identity (3)          | Lightning/Static/Thunder Baang 45/60/68            | card data only                                                                               |
| Q   | Conduit / Jeonsulsa activation (2)  | Conduit 11, Khun Ran 42                            | Jeonsulsa attribute engine (Phase H)                                                         |
| R   | Position switch / deploy choice (2) | Evan Edrok 14, Name Hunt Station 48                | `switch_position`, deploy-choice decision                                                    |
| S   | Silence (2)                         | The Workshop 66, Jyu Viole Grace 36                | `remove_traits` (Silence = all traits)                                                       |
| T   | Ability copy / repeat-play (2)      | Jyu Viole Grace 36, Twenty-Fifth Baam - Evolved 70 | `copy_ability`, delayed repeat-play trigger                                                  |
| U   | Hand peek (1)                       | Monkeyman 47                                       | `peek_hand` (observer-only)                                                                  |
| V   | Quick-grant / quick-trigger (3)     | Karaka 37/38, Wooden Horse 74                      | `modify_keyword { quick }`, passive on `quick_ability_used`                                  |
| W   | Self-harming / Free+Spend (2)       | The Hand of Arlen 65, Stone Doll 62                | `sequence` of `extinguish`/`spend_shinsu`/`deal_damage`; `free`/`quick` flags                |
| X   | Charge-on-summon synergy (1)        | Sunwoo Nare 64                                     | passive `trigger: summon` → `charge_shinsu`                                                  |
| Y   | Equipment assembly (4)              | Thorn Fragments 18/58/67/21                        | passive `trigger: equip` + `conditional` (all 4 unique equipped) → `discard` + `create_card` |
| Z   | Revert/transform (1)                | Khun Ran - Evolved 43                              | passive `trigger: round_end` → `sequence` (`create_card`, `transform`)                       |

## Node coverage

The grammar must cover these effects with **generic handlers**, never per-card handlers:

- **Primitives** (one handler each): `deal_damage`, `heal`, `give_condition`, `cleanse`, `grant_trait`, `remove_traits`, `slay`, `transform`, `copy_ability`, `copy_traits`, `grant_random_trait`, `peek_hand`, `charge_shinsu`, `light_up`, `extinguish`, `draw_card`, `reclaim_cards`, `create_card`, `summon`, `discard`, `steal`, `disarm`, `switch_position`, `compress_shinsu`.
- **Structural**: `sequence`, `conditional`, `spend_shinsu`, `grant_ability`.
- **Modifiers** (always-on passives): `modify_stat`, `modify_keyword`, `modify_targeting`. Landmark `rules` are always-on board rules registered separately (not modifiers).
- **Predicates**: `has_unit`, `alone_on_line`, `started_with_card`, `has_equipped`, `has_all_equipped`, `has_condition`.
- **Triggers** (new): `attack`, `summon`, `draw`, `free_ability_played`, `quick_ability_used`, `round_start_or_activation`.

## Notes

- Cluster H's `started_with_card` predicate requires `GameState` to record the starting deck composition (presence, or exact copy count — confirm in Phase C).
- Cluster T's "play it 4 more times" needs a delayed/queued repeat trigger — confirm in scope now or document as a follow-up.
- Cluster N's landmark rules are a top-level `rules` list owned by the landmark unit, registered/revoked by `GlobalRuleRegistry` for their board lifetime.
- Cluster Y is a cross-card condition ("all 4 unique Thorn Fragments equipped") — model as a predicate evaluated on the bearer's equipment set.
- `_test_Equipment`/`_test_Skill` (`raw: "test"`) should become structured no-op nodes kept in the allowlist, or be removed from the production set.
