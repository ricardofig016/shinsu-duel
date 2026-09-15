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
- **Drunk** — a uniform random pick each turn over the moves its seat view can verify (pass, fire charge, affordable standard-unit deploys), and a random valid subset for decisions.
- **Mirror mine** — the bot plays the human seat's pick, resolved at start.
- **Randomly generated** — a fresh legal deck drawn from the deck-legal slug pool, seeded and shuffled deterministically.
- **Random from my decks** — one of the human's own legal decks, chosen uniformly, falling back to a generated deck when none is legal.

## Playstyles

A playstyle is a pure function of the seat's own redacted view and a seeded rng:

- `decideTurn(view, rng)` → a player action (`{ type, data }`) without identity fields, which the gateway stamps,
- `resolveDecision(decision, rng)` → `{ decisionId, choices }`.

The view is exactly what `buildStateView` builds for the seat: `currentTurn`, the seat's own sanitized hand, shinsu, field, and its own pending decision. `server/bots/playstyles/decisions.js` projects a decision into the free-choice pool (candidates minus `lockedIds`) that both playstyles resolve within. Drunk's deploy pool mirrors the engine's own deploy preconditions from the view alone — turn, unit type, standard kind, printed position, affordable cost, no same-name unit, line capacity — so a picked move never reaches the engine invalid; the engine stays the referee, and the controller's recovery path handles anything that slips through.

## Deck methods

A deck method is a pure, stateless `resolve(context)`:

```
resolve({ catalog, deckLibrary, ownerUsername, humanPick, rng, dev })
  → { deckId, name, cards: slugs, illegal }
```

Methods run at start time inside the gateway's start resolution (`SocketGateway.#resolveBotDeck`), and the result is validated by `validateDeckCards` like any human pick. A bot seat stores no pick of its own — `game-deck-status` reports the seat as a bot, and the deck stops being secret at the same moment every deck does: the versus reveal. A deck that cannot be made buildable (or legal outside a dev room) aborts the start and the room stays in selection.

The deck-legal slug pool that generated decks draw from is `buildLegalSlugPool` in `server/decks/deckValidation.js` — the same pool shape the engine's default-deck pool uses, excluding Unreachable and test cards.

## The bot seat

`server/bots/botSeat.js` assembles one room's bot seat: roster identity, the playstyle instance, the deck method instance, and the controller bound to the session registry and the gateway's validated paths. The bot seat's rng derives deterministically from the room's game seed (`deriveBotSeed`), so a seeded room replays identically end to end — bot decisions included — without touching the engine's own rng stream.

`server/bots/BotSeatController.js` is the seat's connection and driver:

- it implements `send(event, payload)` and is attached with `session.attach(seatName, controller)`, so the seat can also hold browser connections,
- it reacts only to the snapshots its seat is delivered: a pending decision owned by the seat is resolved first, otherwise an enabled turn is played,
- every move is submitted through `submitAction` / `submitDecision`, stamped and validated like any player input; rejections arrive back through its own `send`,
- one move is in flight at a time, a scheduled move reads the newest view seen, and a rejection (or a playstyle failure) triggers at most one recovery move per snapshot — a first-valid decision resolution, or a pass while the turn is open — so a rejected move can neither stall the game nor loop,
- the driver goes quiet for good on game over.

The reaction delay is `BOT_ACTION_DELAY_MS` in `BotSeatController.js`. It is designed as the humanized-delay point — production bots act after a short randomized pause so their moves read on the board, and the pause doubles as the re-entrancy guard that keeps a bot from reacting inside a broadcast stack frame. Its current value is **0 ms**, a deliberate setting while the project is in its playtesting stage, injected through the controller's `scheduler`/`delayMs` options.

## Fairness invariant

A bot sees only what a human seat sees. It reacts solely to the per-seat snapshots `GameSession` delivers to its connection — the same redacted `getClientState(username)` payload: its own hand readable, the opponent's hand face down, decks as sizes only, decisions only when it owns them — and it never touches `GameState` internals. The net suite pins this over the real transport (`server/game/tests/net/botRoom.test.js`), including the deck-status redaction of the human's pick.

## Testing

Unit suites live in `server/bots/tests/` (registries, playstyles, deck methods, controller) and resolve decks against the fixture catalog. The real-transport suite `server/game/tests/net/botRoom.test.js` drives full bot rooms through the harness: seating, deck resolution per method, both playstyles progressing a game, a dev-room restart where the bot keeps playing in the replacement session, and the information-parity guarantee above.
