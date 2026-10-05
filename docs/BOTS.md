# Bots — Shinsu Duel

This document describes the bot system: how a bot opponent is assembled from a playstyle and a deck method, how it occupies a seat, and the guarantees that keep it a fair seat occupant.

---

## Overview

A bot opponent is a seat occupant with no socket. It is assembled from two independent axes, so every playstyle combines with every deck method and adding one of either is a registry entry, not new architecture:

| Axis            | Lives in                    | Answers                                    |
| --------------- | --------------------------- | ------------------------------------------ |
| Playstyle       | `server/bots/playstyleRegistry.js` | how the seat behaves each turn |
| Deck method     | `server/bots/deckMethodRegistry.js` | where the seat's deck comes from |

The bot roster (`server/bots/botCatalog.js`) gives each playstyle its identity — a display name, the `[BOT]`-prefixed seat name a username slot renders, and a personality blurb. The play page mirrors both registries in `public/pages/play/bots.js` (the server stays the authority: `createRoom` refuses unknown ids); the client's pick travels in the room record as `{ opponent: "bot", bot: "<playstyle>", deckMethod: "<method>" }`.

The first playstyles and deck methods:

- **Whatever** — passes every turn, resolves a forced decision with the first valid candidates.
- **Drunk** — a uniform random pick each turn over every move its seat view projects, and a random valid subset for decisions.
- **Mirror mine** — the bot plays the human seat's re-read deck at start, so a deck edited between pick and start is mirrored as edited.
- **Randomly generated** — a fresh legal deck drawn from the deck-legal slug pool, seeded and shuffled deterministically.
- **Random from my decks** — one of the human's own legal decks, chosen uniformly, falling back to a generated deck when none is legal.

## Playstyles

A playstyle is a pure function of the seat's own redacted view and a seeded rng:

- `decideTurn(view, rng, excluded)` → a player action (`{ type, data }`) without identity fields, which the gateway stamps,
- `resolveRetry(view, excluded, rng)` → the move to submit after a refusal, from the same view,
- `resolveDecision(decision, rng)` → `{ decisionId, choices }`.

The controller refuses a playstyle that does not expose all three; Whatever satisfies `resolveRetry` with the same pass it plays every turn. The view is exactly what `buildStateView` builds for the seat: `currentTurn`, the seat's own sanitized hand, shinsu, field, and its own pending decision. `server/bots/playstyles/decisions.js` projects a decision into the free-choice pool (candidates minus `lockedIds`) that both playstyles resolve within.

`server/bots/turnOptions.js` is the one projection of the engine's action preconditions: `projectTurnOptions(view)` mirrors what the action handlers' `validate()` methods admit — pass, a fire charge, one `use-ability-action` per printed and granted ability, an affordable skill in hand, an equipment against each owned unit, a position switch toward each other printed position, and a deploy per printed position (or one through its kind's placement slot for a non-standard card). It is a pure function of the view and never touches `GameState`; the contract suite `server/bots/tests/turnOptions.test.js` feeds every projected move back to the engine, which is what keeps the mirror honest. `moveKey(move)` is the single definition of move identity, so the controller's exclusion set and the tests agree on what "the same move" means.

Two rules shape the pool. A precondition the view cannot read is attempted rather than excluded, so a legal move is never hidden — a requirement entry carrying no `check` at all is read the same way. Capacity is not a filter: a full line substitutes rather than refusing (RULES.md §Battlefield 6), so an overflowing deploy stays in the pool and the engine answers it with the `line_overflow` decision the controller resolves.

Drunk keeps no candidate logic of its own. `decideTurn` projects that pool, drops the moves `excluded` names, drops `pass-turn-action` while any other move remains, and picks uniformly among what is left. Pass does nothing, so it is the last resort rather than one choice among many: never picked while a real move remains, and the answer when nothing is left.

### Unverifiable preconditions

Three cases stay unverifiable from the view, and all are attempted rather than excluded, because a refused move costs a retry and never the turn:

- `first_card_this_round` reads the engine's private per-round play counter, which no seat view carries.
- Affordability is read from the card view, not asked of the engine: the pool uses the `effectiveCost` the seat projection resolved, and falls back to the printed cost when a card view carries none. A discount the view does not carry — a card view without a resolved cost, or one that reaches only the engine after the snapshot the bot is acting on — is invisible to the pool, so the engine charges the real number and refuses the move, which costs a retry.
- An equip under a landmark's `prevent_equip` rule: the engine applies the rule in `LifecycleEngine.attachEquipment` during execute, and the view ships a landmark's rules as display segments, so no check can be built from them.

## Deck methods

A deck method is a pure, stateless `resolve(context)`:

```
resolve({ catalog, deckLibrary, ownerUsername, humanDeck, rng })
  → { deckId, name, cards: slugs, illegal }
```

`humanDeck` is the human seat's deck record re-read at start time — the same live deck the human seat itself plays under, so a deck edited between pick and start is what a deck method that depends on it resolves. Methods run at start time inside the gateway's start resolution (`SocketGateway.#resolveBotDeck`), and the result is validated by `validateDeckCards` like any human pick. A bot seat stores no pick of its own — `game-deck-status` reports the seat as a bot, and the deck stops being secret at the same moment every deck does: the versus reveal. A method that throws, or a deck that cannot be made buildable (or legal outside a dev room), aborts the start and the room stays in selection; the next start trigger — a re-pick, a reconnect — resolves again.

The deck-legal slug pool that generated decks draw from is `buildLegalSlugPool` in `server/decks/deckValidation.js` — the same pool shape the engine's default-deck pool uses, excluding Unreachable and test cards.

## The bot seat

`server/bots/botSeat.js` assembles one room's bot seat: the spec is validated there (`parseBotSpec`), making `createBotSeat` the single refusal point for a broken room record — the gateway catches its throw and refuses the connection. From the validated spec it builds the roster identity, the playstyle instance, the deck method instance, and the controller bound to the session registry and the gateway's validated paths. The bot seat's rng derives deterministically from the room's game seed (`deriveBotSeed`), so a seeded room replays identically end to end — bot decisions included — without touching the engine's own rng stream.

`server/bots/BotSeatController.js` is the seat's connection and driver:

- it implements `send(event, payload)` and is attached with `session.attach(seatName, controller)`, so the seat can also hold browser connections,
- it reacts only to the snapshots its seat is delivered: a pending decision owned by the seat is resolved first, otherwise an enabled turn is played,
- every move is submitted through `submitAction` / `submitDecision`, stamped and validated like any player input; rejections arrive back through its own `send`,
- one move is in flight at a time and a scheduled move reads the newest view seen, so a rejection is answered from the freshest snapshot,
- a rejection — or a playstyle that throws while choosing — does not spend the turn: the controller keeps the moves attempted for the current snapshot — cleared on every snapshot — adds the refused move's key, and asks the playstyle through `resolveRetry(view, excluded, rng)` for another move excluding everything attempted. Each retry must name a move the projection has not offered yet for that snapshot, so the finite pool drains to a pass on its own; the bound is structural rather than a retry counter, and a playstyle with nothing new to offer ends the snapshot quietly,
- the driver goes quiet for good on game over.

The reaction delay is `BOT_ACTION_DELAY_MS` in `BotSeatController.js`. It is designed as the humanized-delay point — production bots act after a short randomized pause so their moves read on the board, and the pause doubles as the re-entrancy guard that keeps a bot from reacting inside a broadcast stack frame. Its current value is **0 ms**, a deliberate setting while the project is in its playtesting stage, injected through the controller's `scheduler`/`delayMs` options.

## Fairness invariant

A bot sees only what a human seat sees. It reacts solely to the per-seat snapshots `GameSession` delivers to its connection — the same redacted `getClientState(username)` payload: its own hand readable, the opponent's hand face down, decks as sizes only, decisions only when it owns them, and no engine-private state such as the per-round card counter — and it never touches `GameState` internals. The net suite pins this over the real transport (`server/game/tests/net/botRoom.test.js`), including the deck-status redaction of the human's pick.

## Testing

Unit suites live in `server/bots/tests/` (registries, playstyles, the turn-option projection, deck methods, controller) and resolve decks against the fixture catalog. The real-transport suite `server/game/tests/net/botRoom.test.js` drives full bot rooms through the harness: seating, deck resolution per method, both playstyles progressing a game, a dev-room restart where the bot keeps playing in the replacement session, and the information-parity guarantee above.
