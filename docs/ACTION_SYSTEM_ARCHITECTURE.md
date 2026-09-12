# Action System Architecture — Shinsu Duel

This document describes the player-action layer: how client requests become validated, authoritative game-state mutations.

---

## Overview

Actions are the **only entry point** for a player to interact with the game (playing cards, using abilities, passing). Every action is a class extending `ActionHandler`, registered in `server/game/registries/actionRegistry.js` under a kebab-case type string. `GameState.processAction(action)` dispatches to the registry:

```js
game.processAction({
  type: "deploy-unit-action",
  data: {
    source: "player",
    username: "Alice",
    handId: 0,
    placedPositionCode: "scout",
  },
});
```

Actions **validate first, mutate second**. They never mutate `playerState` fields directly — card movement and shinsu changes delegate to the same services handlers use (`ZoneService`, `ShinsuService`, `LifecycleEngine`).

---

## ActionHandler Contract

```js
// server/game/ActionHandler.js

export default class ActionHandler {
  static schema = {
    /* field name → expected typeof */
  };
  static sourceAccess = { player: boolean, debug: boolean, system: boolean };

  validate(data, gameState) {
    /* source access, schema, then game-rule checks; throw on failure */
  }
  execute(data, gameState) {
    /* perform the mutation */
  }
}
```

`super.validate(data)` runs three layers before any game-rule check:

1. **Source access** — `sourceAccess[data.source]` must be truthy. A message stamped with a source the action does not admit is refused before the payload is examined, so a disallowed caller never reaches game logic and never learns a schema error. `player` is the normal entry point (the gateway stamps it on `game-action`), `debug` belongs to the dev console (see `DEV_CONSOLE.md`), and `system` is reserved for server-internal actions when one is required. Resource mutations that are not player choices bypass the action layer.
2. **Schema validation** (`validateSchema`) — every field in `schema` must be present with the declared `typeof`; any field outside the schema is rejected (`Unexpected field`). This prevents malformed or tampered payloads from reaching game logic.
3. **Game rules** — subclass `validate()` then adds the checks: the actor exists, it is their turn, the card/unit exists, costs are affordable, and requirements are met (via `RequirementValidator`). These run before any state change, so a failed action leaves the game untouched.

---

## Registry

`actionRegistry.js` maps wire type strings to singleton instances. Handlers hold no per-invocation state.

| Type                          | Class                      | Schema fields                                  | Ends turn                  |
| ----------------------------- | -------------------------- | ---------------------------------------------- | -------------------------- |
| `deploy-unit-action`          | `DeployUnitAction`         | `source, username, handId, placedPositionCode` | Yes (deferred on overflow) |
| `equip-equipment-action`      | `EquipEquipmentAction`     | `source, username, handId, targetUnitId`       | Yes                        |
| `use-ability-action`          | `UseAbilityAction`         | `source, username, unitId, abilityCode`        | Only if not Quick          |
| `play-skill-action`           | `PlaySkillAction`          | `source, username, handId`                     | Yes (deferred on choice)   |
| `pass-turn-action`            | `PassTurnAction`           | `source, username`                             | Yes                        |
| `switch-position-action`      | `SwitchPositionAction`     | `source, username, unitId, positionCode`       | Yes                        |
| `generate-fire-charge-action` | `GenerateFireChargeAction` | `source, username`                             | No                         |

### Debug actions

The dev console's mutations are actions too: one class per command under `server/game/actions/debug/`, all extending `DebugAction`, registered under a `debug-*` type, and all admitting `source: "debug"` only. They delegate to the same services player actions use (`ZoneService`, `ShinsuService`, `LifecycleEngine`, `UnitService`, `LighthouseService`), and they never mutate state fields directly. Two differences from a player action:

- their `username` is the seat the command acts on rather than the actor, and `requestedBy` carries the player who issued it;
- their schema declares only the arguments that command takes, so a command with no target seat carries no `username` field at all.

The command surface, the arguments each type takes, and what a mutation records are documented in `DEV_CONSOLE.md`. Commands that need behavior the game owns (ending a round, forcing a turn, setting the round counter) call the narrow `GameState` methods for it instead of writing those fields.

### Ability resolution

`UseAbilityAction.resolveAbility(gameState, unit, abilityCode)` resolves an `abilityCode` into `{ ability, sourceId, sourceType }`:

- numeric index → the unit's compiled DSL ability (`unit.card.abilities[i]`)
- `granted:<sourceId>:<type>` → an ability granted at runtime (e.g. by equipment via `grant_ability`), resolved through `GameState._abilityRegistry` (see `HANDLER_SYSTEM_ARCHITECTURE.md`). Removing the source (unequip) revokes the registry entry and makes the code unresolvable.

### Quick / Free semantics

`UseAbilityAction` enforces RULES.md keywords:

- **Free** (`ability.free`) — does not consume the unit's combat slot.
- **Quick** (`ability.quick`) — does not call `gameState.endTurn()`.

Non-Free abilities mark the position's combat slot spent; Shinheuh abilities consume the Anima Shinheuh slot instead. `Heavy` condition adds to the ability cost; `Poisoned` triggers after resolution if the unit survives.

---

## Decision Continuations

Actions that produce a player choice (line overflow, target selection) must not advance the turn before that choice has mutated state. They register the rest of their work as a continuation via `gameState.completeActionAfterDecision()` — the mechanism (immediate run when idle, FIFO queueing) is documented in the [Pending Decisions](GAMESTATE_ARCHITECTURE.md#pending-decisions) section of `GAMESTATE_ARCHITECTURE.md`.

---

## Anti-patterns

- **Don't mutate state in `validate()`** — validation must be side-effect free.
- **Don't bypass the registry** — always go through `processAction()`.
- **Don't end the turn inline** when a decision may be pending — use `completeActionAfterDecision`.
- **Don't hand-parse `abilityCode` strings** — use `resolveAbility()`.
