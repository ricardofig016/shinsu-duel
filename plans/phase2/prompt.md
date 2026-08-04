start by reading PROJECT_RESURRECTION_PLAN.md, RULES.md, and all the files in docs/ before you do anything else to understand the project scope.

phase 0 and 1 are complete, and your job is to write a full plan for phase 2. carefully analyse everything implemented until now, pay special focus for agentic, behaviour, and objectivies found in the sources markdowns. if you have any questions while mapping out the plan, ask me for clarification. do not assume anything. treat RULES.md as the absolute source of truth for game rules. the only thing above it is me. ask me for clrification on anything you are unsure about.

maximize for excelent, enterprise-level design and architecture, code cleanliness, maintainability, extensibility, and scalability. identify exactly what is the porpuse of this phase, how it ties together with the previous and following phases, and its role in the overall project and project resurrection. identify all the gaps, pitfalls, and features that need to be addressed in this phase. provide clear acceptance criteria for each task and subtask. ensure that the plan aligns with the overall project goals and objectives. the most important thing here that i need you to constantly keep in mind while planning out this phase is that we need to expect that the most unique and complex cards with the most unique and complex interactions will be added to the game in the future, and phase 2 needs to be designed to handle everything any future mechanic can throw at it. don't be too afraid to overengineer the architecture in the persuit of perfection.

take some time at the end of your reasoning to actually brainstorm the most absurd and complex interactions you can think of, and analyse how your architecture and design would handle them.

include a special step in your plan (before final validations and testing etc) to make sure that the implemented components are well encorporated into the existing project, and not just thrown in as an independent module. the implementation should feel like it fits with the components created in the previous phases.

every component should be thoroughly tested and every major architecture component should be documented in docs/ in the style, structure, format, and vibe of the existing docs there.

## Overview of Phase 0+1

Here is the detailed Phase 0+1 overview, written specifically for the Phase 2 planning agent. Key sections:

### What Phase 0 delivered

- 66 compiled cards in cards.json with a DSL of **11 effect types** — 8 have handler implementations, `grant_ability`, `destroy_lighthouse`, and `reclaim_cards` do not, and ~130 raw `custom` effects have `handler: null`.
- Critical: several types are **nested** (e.g., `spend_shinsu` wraps an inner `effect`, `grant_ability` wraps a full ability DSL). Phase 2's resolution logic must traverse recursively.

### What Phase 1 built

- **GameClock** — shared monotonic counter for deterministic `sourceAge` tiebreaking.
- **EventBus** — DFS event engine with 4 phases. `context.emitChild()` triggers nested resolution. Error-isolated, recursion-guarded.
- **ModifierStack** — provenance-tracked state modifier store. Solves equipment→silence→unequip correctly.
- **Logger** — state-diff logger with causation trees and pluggable backends.
- **8 baseline handlers** in handlers, all extending `BaseHandler`.

### Architecture diagram

```
GameState → GameClock → EventBus → ModifierStack → Logger
              actionRegistry → DeployUnit/PassTurn/UseAbility/AddLighthouses
              playerStates → deck/hand/field/shinsu/lighthouses
              _barrierUsedThisRound (NOT reset on round start — pitfall!)
```

### 10 specific pitfalls the Phase 2 agent must know

1. `_barrierUsedThisRound` is never reset on round start
2. Condition cleanup at round end is not wired
3. `AddLighthousesAction` bypasses ModifierStack and mutates state directly
4. Event naming is inconsistent (PascalCase `OnTurnEnd` and namespaced `unit:killed` coexist)
5. `sourceId` generation is ad hoc with no standardized convention
6. `_findUnit()` is a linear scan across both players' fields
7. `_createSnapshot()` must be extended when Phase 2 adds conditions/traits to state
8. `grant_ability`, `destroy_lighthouse`, `reclaim_cards` have no handler implementations yet
9. Nested DSL structures need recursive traversal logic
10. Evolution/ignition triggers exist in cards.json but are completely unresolved at runtime

The full overview is saved to session memory at `/memories/session/phase-overview.md`.

## Phase 1 Audit: COMPLETE ✓

### What passed

| Check                 | Result                                                                            |
| --------------------- | --------------------------------------------------------------------------------- |
| **Tests**             | 14 suites, 179 tests, ALL passed                                                  |
| **Data pipeline**     | `validate:cards` + `compile:cards` — 66 cards, all pass                           |
| **Legacy references** | 0 remaining `.publish()`, `.subscribe()`, `.unsubscribe()` calls                  |
| **Legacy files**      | All 8 removed (Ability, PassiveAbility, 3 dirs, 3 registries)                     |
| **Documentation**     | 5 architecture docs in docs covering every subsystem                              |
| **Determinism**       | Verified by test that runs identical setup 20× and asserts same output            |
| **DFS correctness**   | Verified by 3 nesting tests (child→sibling, grandchild→post, sibling isolation)   |
| **Silence/equipment** | Verified by test that proves no negative trait on equip→silence→unequip→unsilence |

### Known gaps (NOT Phase 1's responsibility)

These are all Phase 2 items — none block Phase 1 completion:

| Gap                                                                   | Severity        | Phase   |
| --------------------------------------------------------------------- | --------------- | ------- |
| `_barrierUsedThisRound` not reset on round start                      | Bug             | Phase 2 |
| Event naming mix (PascalCase `OnTurnEnd` vs namespaced `unit:killed`) | Tech debt       | Phase 2 |
| `AddLighthousesAction` bypasses ModifierStack                         | Tech debt       | Phase 2 |
| `sourceId` generation ad hoc                                          | Tech debt       | Phase 2 |
| `grat_ability`/`destroy_lighthouse`/`reclaim_cards` not handled       | Missing feature | Phase 2 |
| Unit.js has one `// Stub` comment for Phase 3/4                       | Expected        | Phase 3 |

### Verdict

**Phase 1 is fully complete and integrated.** All acceptance criteria from PROJECT_RESURRECTION_PLAN.md are met — and exceeded (the plan didn't call for ModifierStack, HandlerRegistry, 8 baseline handlers, or 5 architecture docs). The codebase is clean: zero legacy shims, zero stale references, zero compat wrappers. Ready for Phase 2 planning.

## FAQ

Q: Should Phase 2 implement full trigger parsing (raw text to event subscriptions, auto-trigger) or just build transformer infrastructure and defer raw trigger parsing to Phase 4?
A: Full trigger system - Parse raw trigger text, register listeners, auto-trigger evolution/ignition.

Q: How many of the 7 attribute mechanics should Phase 2 implement? (Anima, Silver Dwarf, Red Witch, Hwayeomsa, Jeonsulsa, Irregular, Living Ignition Weapon)
A: 2 complex ones so we can validate your architecture is generaly sturdy - lets go with anima and hwayeomsa. the rest is phase 4.

Q: Which missing handlers should Phase 2 implement? compress_shinsu (~3 uses), charge_shinsu (~2 uses), reclaim_cards (1 use), grant_ability (2 uses).
A: All four handlers - Implement compress_shinsu, charge_shinsu, reclaim_cards, and grant_ability.

Q: The empty directories (abilities/, passive_abilities/, effects/continuous/, effects/triggered/) are legacy. Should Phase 2 replace them with a new structure or fill them?
A: Never under any circumstances sacrifice good architecture and cleanliness for backwards compatability and legacy implementation. The plan is to rewrite the engine, not to patch it up. your decision should be completely transparent and ignore the existing folders. if they match your design, fine, if they dont, thats perfectly fine. do not let subpar legacy implementation sway you from the path of excelent design.

Q: For full evolution/ignition support, may Phase 2 add a canonical compiler-time parser that converts source trigger text into typed ASTs (runtime never parses raw)?
A: Yes — typed AST at compile time - Recommended; unsupported canonical triggers fail compilation until modeled.

Q: How should Phase 2 represent effects requiring choices (targets, overflow destruction, reclaimed card, Incinerate targets)?
A: Pending-decision state - Engine pauses with validated candidates; player resolves a typed decision. Recommended for arbitrary future interactions.

Q: When an evolution/ignition trigger is met, what default behavior should the engine enforce?
A: Mandatory immediate transform - Recommended default: after triggering event resolves, preserve damage, conditions, attachments, grants, identity, and slot state; atomically replace definition/subscriptions.

Q: Fire Core and Incinerate I–IV are defined in RULES.md but absent from `data/cards/`. What source model should Phase 2 plan?
A: add the missing cards (fire core and the 4 incenerates) as yml files. necessary info for card text is in readme. they are all unreachable. there are no system cards, all cards come from the yml files.