# Dev Console

The dev console gives a developer full manual control of a live game from the browser devtools console. It exists for testing card interactions by hand: draw what you need, put the card on the board, set a unit's HP, and watch the engine's events in the same window.

It works in dev rooms only. Every console message is refused in any other room, which plays exactly as it always did. `docs/LOGGER_ARCHITECTURE.md` has the room-code rule and how to create such a room.

## Using it

Open a game page in a dev room and load the page with devtools open. The module prints `[dev] console ready.` and exposes `window.debug`:

```js
debug.help()                 // the command list with argument names
debug.hand()                 // your own hand, with instance ids
debug.deck("Bob")            // the opponent's deck in draw order
debug.addToHand(10001)       // create a card in your hand
debug.spawn(10001, "scout")  // put that card on your field for free
```

`debug.addToHand` and `debug.spawn` take a card id, which `debug.card("Test Scout")` resolves from the catalog the page already loads, and `debug.state()` shows every id in play.

The console runs on its own socket connection on your current seat, so the page's own connection and rendering are untouched. Both seats of a dev room may issue commands and may target either seat, because self-play is the normal way to use this.

## Commands

Every command that acts on a seat takes an optional seat argument that defaults to your own seat.

| Method                                     | Arguments                      | What it does                                                                                   |
| ------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `debug.draw(amount = 1, seat?)`             | non-negative integer           | Draws from the seat's deck, announcing each draw like the per-round draw. An empty deck loses.  |
| `debug.mulligan(amount = 5, seat?)`         | non-negative integer           | Returns the whole hand to the deck, shuffles it with the seeded RNG, then draws `amount`.       |
| `debug.addToHand(cardId, seat?)`            | compiled card id               | Creates a card instance from the catalog and puts it in the seat's hand.                        |
| `debug.addToDeck(cardId, placement, seat?)` | `"top"` or `"bottom"`          | Creates a card and inserts it into the seat's deck. `"top"` is the next card drawn.             |
| `debug.shuffleDeck(seat?)`                  |                                | Shuffles the seat's deck with the game's seeded RNG.                                            |
| `debug.grantShinsu(amount, seat?)`          | positive integer               | Gains shinsu for the seat. The rules cap for the round still applies.                           |
| `debug.endRound()`                          |                                | Ends the round now: conditions clear, shinsu resets, both seats draw, the round-start phase runs. |
| `debug.forceTurn()`                         |                                | Hands the turn to the other player through the normal turn lifecycle, without ending the round. |
| `debug.setRound(round)`                     | positive integer               | Sets the round counter. No round processing runs.                                               |
| `debug.spawn(cardId, positionCode, seat?)`  | compiled card id, position     | Puts a unit on the seat's field for free: no cost, no combat slot, no turn change.              |
| `debug.setUnitHp(unitId, value)`            | unit instance id, integer >= 0 | Writes a deployed unit's HP.                                                                    |
| `debug.destroyUnit(unitId)`                 | unit instance id               | Destroys a deployed unit through the lifecycle engine.                                          |
| `debug.modifyLighthouses(delta, seat?)`     | integer                        | Changes the seat's lighthouse count. The 0-40 clamp and the loss at 0 are unchanged.            |
| `debug.restart()`                           |                                | Returns the room to the deck-selection step (see Restart below).                                |
| `debug.firehose(enabled?)`                  | boolean, defaults to a toggle  | Turns the engine event stream on or off for the session.                                        |

`debug.setUnitHp` is a raw write through `UnitService`: it is neither damage nor healing, so no damage or heal trigger fires from it. Setting 0 leaves a unit on the field at 0 HP; destroy it with `debug.destroyUnit` to run the destruction pipeline.

## Queries

Queries read state and resolve with their result. They never change the game and are never recorded.

| Method                    | Arguments        | Result                                                                            |
| ------------------------- | ---------------- | --------------------------------------------------------------------------------- |
| `debug.hand(seat?)`        | seat             | `{ username, cards }`, one `{ cardId, instanceId, name }` per card in hand order. |
| `debug.deck(seat?)`        | seat             | `{ username, cards }`, in draw order: the first entry is drawn next.              |
| `debug.abilities(unitId)`  | unit instance id | `{ unitId, name, owner, native, granted }`. `native` entries carry the printed ability together with the `abilityCode` the client sends back to `use-ability-action`; `granted` entries carry the code, the ability, and the id of the source that granted it. |
| `debug.state()`            |                  | `GameState.toSerializedState()`: zones, modifiers, granted abilities, counters, RNG. |
| `debug.logs()`             |                  | `logger.getLogs()`: every recorded entry with its diffs and causation trees.      |
| `debug.card(idOrName)`     | card id, slug, or name | A catalog card view, or `null` when nothing matches.                        |

## What reaches the replay artifact

Every mutation counts as a recorded player input, exactly like a deploy or a pass. A TESTROOM room's replay artifact therefore contains the console commands that were issued, and replaying it reconstructs the same game. Queries, the firehose, and the restart leave no trace: the first two only read, and the restart hands the room to a new game whose artifact is its own.

## Event firehose

The firehose prints one line per engine event, named the way the engine names it, with a running sequence number and the event's scalar payload fields:

```
[event #12] unit:deployed owner=Alice unitId=Unit#10001#7 cardId=10001
```

Reading a chain is easier than reading a tree: children of a root event do not print their own line, and the logger dump has the full causation tree when you need it.

The stream is toggled with `debug.firehose(false)` and `debug.firehose(true)`. In a normal room the toggle is refused like every other console message.

## Restart

`debug.restart()` puts the room back at the deck step: both seats pick again and a new game starts. The game you were playing, its revision, and its deck picks are gone; room records and player accounts are untouched.

The page renders the deck step on its own when it comes back. The console module also clears the game-over overlay, which the page itself never resets.

## Talking to the server

The console runs on its own socket connection and reads three things from it: the answer to a query, the firehose lines, and a `game-error` when the server refuses a command. The message names, directions, and payload shapes are in the [Dev Console section of the network architecture](NET_PROTOCOL_ARCHITECTURE.md#dev-console); nothing here redefines them.

A query promise settles exactly once: with its result, with the refusal, or on a ten second timeout, so a lost message cannot leave a command pending forever.

## Files

| File                                          | Role                                                            |
| --------------------------------------------- | --------------------------------------------------------------- |
| `server/game/actions/debug/DebugAction.js`     | Base class: source access, schema, catalog and unit helpers.     |
| `server/game/actions/debug/Debug*Action.js`    | One class per command, each delegating to the owning service.    |
| `server/game/net/debugQueries.js`             | Query kinds and their read-only projections.                     |
| `server/game/net/eventFirehose.js`            | The dev-room event streamer.                                     |
| `server/game/net/socketGateway.js`            | Gating, identity stamping, and the console's inbound paths.      |
| `public/game/debugConsole.js`                 | `window.debug` and its socket connection.                        |
| `public/game/debugOutput.js`                  | Output formatting and the card index behind `debug.card`.        |
