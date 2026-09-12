# Net Protocol Architecture — Shinsu Duel

This document describes the net layer: the session core, the wire protocol, the socket gateway, and the event bridge that connect the browser to the authoritative engine.

---

## Overview

The layer lives in `server/game/net/` and has one job per module:

| Module                | Responsibility                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| `GameSession.js`      | One live game: two seats, the players' connections, the `GameState`, revision counter |
| `SessionRegistry.js`  | Maps room codes to sessions; sessions live until the process exits or a dev-room restart replaces them |
| `protocol.js`         | Owns every event name and payload builder; builders are pure                          |
| `socketGateway.js`    | Binds Socket.IO to sessions; validates every inbound message                          |
| `eventBridge.js`      | Forwards engine events that must reach a player outside the action cycle              |
| `eventFirehose.js`    | Streams compact engine event lines to a dev room's seats                              |
| `debugQueries.js`     | The dev console's read-only queries and their projections                             |

`server/createGameServer.js` assembles the express app, the HTTP server, Socket.IO, and the gateway. Its collaborators (session registry, room lookup, game factory, file logging) are injectable; `server/app.js` is the production entry that calls it with defaults, and the test harness boots the same factory with test doubles.

---

## Session and Seat Model

A `GameSession` is created on demand when a seat connects to a two-player room (creation is idempotent: the first request wins, later requests return the same session). The session owns:

- two seats identified by username, taken from the room record's player list,
- the pre-game deck selections (one pending pick per seat; see [Deck Selection](#deck-selection)),
- one `GameState`, created exactly once through the injected `createGame` factory once both seats are connected and both hold a valid deck selection,
- a monotonic revision counter (see below).

A **seat** holds that player's current connections in a set. A **connection** is anything with `send(event, payload)` (sockets also get `close`). One player can play from several tabs because every tab is just another connection on the same seat, and a future bot controller occupies a seat the same way without a socket (see [Bot Seam](#bot-seam)). `attach`/`detach` are idempotent, and `isFull()`/`isEmpty()` describe seat occupancy.

Sessions are never deleted on disconnect. They live until the process exits, so a dropped player rejoins the exact game, open decision included. This matches the express-session memory store, which also does not survive a restart. The one thing that does drop a session is a dev-room restart, which replaces it with a fresh one and moves the connections over (see [Dev Console](#dev-console)).

---

## Protocol Events

All names come from `EVENTS` in `protocol.js`; the net layer contains no raw event-name literals. Reserved transport names (`connection`, `disconnect`) are listed separately in `TRANSPORT_EVENTS`.

| Event                 | Direction        | Sent when                                                                      |
| --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `game-deck-select`    | client → server  | pre-game deck selection; the sender picks one of their own decks                 |
| `game-action`         | client → server  | player action (deploy, pass, ability, skill, equipment, position switch, ...)   |
| `game-decision`       | client → server  | resolving a pending decision                                                    |
| `game-state-request`  | client → server  | asking for the current view (transport reconnect, manual refresh)               |
| `debug-action`        | client → server  | dev-console mutation, refused outside a dev room                                |
| `debug-query`         | client → server  | dev-console read, refused outside a dev room                                    |
| `debug-firehose`      | client → server  | dev-console firehose toggle, refused outside a dev room                         |
| `debug-restart`       | client → server  | dev-console restart, refused outside a dev room                                 |
| `game-init`           | server → client  | game start, rejoin to a started session, answer to a state request              |
| `game-update`         | server → client  | after each accepted action or decision, broadcast to every seat                 |
| `game-error`          | server → client  | a rejected message; delivered to the sender only                                |
| `game-over`           | server → client  | the action that ends the game, and again for any action sent after game over    |
| `game-waiting`        | server → client  | a lone player in an unfinished room (no session can exist yet)                  |
| `game-hand-peek`      | server → client  | a hand-peek reveal, delivered to the peeking player's connections only          |
| `game-deck-status`    | server → client  | per-seat selection progress during the pre-game deck-selection phase            |
| `debug-result`        | server → client  | the answer to one `debug-query`, delivered to the sender only                   |
| `debug-event`         | server → client  | one root engine event, broadcast to both seats of a dev room                    |

### Payloads

Every payload is built in `protocol.js` and builders return the exact object on the wire:

- `buildStateView({ game, revision, username })` wraps `GameState.getClientState(username)` with the session revision. The shape of that per-username view (hidden opponent hand, owner-only pending decision, condition magnitudes, runtime traits, equipment, granted abilities, positions) is documented in `GAMESTATE_ARCHITECTURE.md`.
- `buildError(message, code)` returns `{ message }`, plus `code` when the rejection carries one. `code` is validated against `ERROR_CODES`, so a client can act on the reason instead of on the message text; an identity failure (`unauthenticated`) is the only coded rejection today (see `AUTHENTICATION.md`).
- `buildGameOverResult(gameOver)` returns `{ winner, reason }`.
- `buildWaitingPayload()` returns the fixed waiting message.
- `buildHandPeek(peek)` returns an independent copy of the reveal.
- `buildDeckSelect({ deckId })` returns `{ deckId }` for the inbound selection.
- `buildDeckStatus({ dev, seats })` returns `{ dev, seats }`, one entry per seat
  in seat order: `{ username, deckChosen, deckId, deckName, illegal }`. `dev` is
  the room's dev-room flag (`isDevRoomCode`), so the client knows whether
  illegal decks are selectable there, and `deckId` lets each seat recognize its
  own pick in the list.
- `buildDebugResult({ requestId, kind, data })` returns the query's own data with the request id it answers, so the console resolves the matching request. It is only ever built for an accepted query; a refusal is a `game-error`.
- `buildDebugEvent({ sequence, eventName, payload })` returns `{ sequence, name, fields }`, where `fields` holds the payload's scalar entries and scalar arrays. Engine payloads carry live objects that alias game state and are not JSON-safe, so a line never includes them.

The client mirrors the event names in `public/game/protocol.js` and builds its outbound payloads through `public/game/actions.js`; client and server ship together, so there is no wire compatibility layer.

---

## Revision Semantics

The revision counter starts at 0 and is bumped:

- by 1 when the session's game is created,
- by 1 for each accepted player action,
- by 1 for each accepted debug action (a dev-console mutation is an engine action),
- by 1 for each accepted decision.

Rejected input never bumps the counter, so a client comparing revisions can tell whether it has missed a snapshot. Every outbound snapshot (`game-init` and `game-update`) carries the session's current revision. Deck selections happen before any game state exists, so they never touch the counter, and neither do dev-console queries, their results, the firehose, or the firehose toggle.

---

## Deck Selection

Between "both seats connected" and "game created" sits the deck-selection phase. The gateway owns it:

- **Picking.** `submitDeckSelect` validates the payload (`{ deckId }`), the sender's seat, and that the game has not started; resolves the deck through the deck library (`getOwnedDeck`, so a foreign or unknown deck is rejected); and gates selectability: a normal room accepts only decks the live validation calls legal, a dev room (`isDevRoomCode`) accepts anything buildable. The accepted pick is stored on the session (one per seat, replaced on re-pick, kept across disconnects, cleared at start) and broadcast to both seats as `game-deck-status`.
- **Starting.** Once both seats are connected and both hold a valid pick, the gateway re-validates every pick against the live deck library (a deck deleted, made unbuildable, or — in a normal room — made illegal between pick and start sends that seat back to selection), resolves the stored slugs to cardIds through the compiled catalog, and creates the game with `{ decks, enforceDeckRules }`. `enforceDeckRules` is false only in a dev room where some picked deck is illegal. Picks are cleared once the game started; a pick sent afterwards is rejected ("The game has already started."). Two picks landing together, or a pick racing the second connection, can both ask for the start, and resolving picks is asynchronous; the gateway keeps one in-flight start per session, so the game is created once from the picks that triggered it.
- **Progress.** A state request on an unstarted session answers with `game-deck-status` instead of `game-waiting`, so a seat that reconnects during selection sees the current progress and its earlier pick. `game-waiting` is reserved for rooms whose second player has not joined.

The game page renders this phase as its pre-game deck step (see `DECK_COLLECTION.md` for where its data comes from). The deferred-start seam is also where a future bot controller would inject its pick instead of going through `submitDeckSelect`.

---

## Inbound Validation

Both inbound paths funnel through the gateway before anything reaches the engine (the deck-selection path is covered in [Deck Selection](#deck-selection)):

1. **Shape validation.** Actions must be `{ type, data }` with a non-empty string type and a plain-object data payload; decisions must be `{ decisionId, choices }` with a non-empty string id and an array of choices; dev-console queries must be `{ kind, requestId, username?, unitId? }` with non-empty string kind and request id, and the firehose toggle must be `{ enabled }` with a boolean. Anything else is answered with a `game-error` ("Malformed action/decision payload.") and never reaches the engine.
2. **Identity stamping.** The connection's authenticated username is written onto the action; a payload claiming another player is ignored.
3. **State guards.** Actions or decisions sent before the game starts are answered with a `game-error` ("Game has not started yet."); after game over they are answered with the `game-over` result and leave the state untouched. `game-waiting` is reserved for parked lone players and for state requests that arrive before the game exists.
4. **Engine rejection.** Engine throws (unknown action type, wrong turn, invalid choices, foreign decision id, ...) are forwarded as `game-error` to the sender; the revision and state stay unchanged.

Accepted actions and decisions broadcast a `game-update` per seat, preceded by `game-over` when the move ended the game.

Identity comes from the express-session username, and only a name that still has an account is accepted, the same rule the HTTP gate applies (see `AUTHENTICATION.md`). `createGameServer` shares its session middleware with the Socket.IO engine (`io.engine.use`), so the handshake cookie authenticates the socket; the room record must list that username as a participant. Room creation and joining stay on the existing REST endpoints.

---

## Dev Console

The four `debug-*` inbound messages are refused in any room whose code is not a dev room (`isDevRoomCode`), before the session is read. In a dev room they move through the same seat and state guards as player input, then diverge by intent:

- **Mutations** (`debug-action`) are stamped `source: "debug"` and `requestedBy` and run through `processAction`, so the revision, the per-seat broadcast, the Logger, and the replay artifact all see them as engine actions. The seat a command acts on travels in `data.username` and is validated against the session's seats before the engine sees it; a command with no target seat carries no `username` field, and the action's own schema refuses one that is missing.
- **Queries** (`debug-query`) call a read-only projection from `debugQueries.js` and answer the sender with `debug-result`, echoing the request id. They bump nothing and record nothing, which is what keeps a replay artifact the length of the mutations actually applied. A refused query is answered with `game-error`, not with a result.
- **The firehose toggle** (`debug-firehose`) flips a session flag. A dev room's `eventFirehose.js` subscription streams one compact `debug-event` line per root engine event to both seats while the flag is on; it is on by default and carries no game state.
- **The restart** (`debug-restart`) replaces the game rather than mutating it: the gateway unsubscribes the session's streamers, cancels a start still resolving for it, takes its connections away, drops it through `SessionRegistry.remove`, and attaches every connection to a fresh session for the same room, which broadcasts the deck-selection progress. The abandoned session keeps no connections and can never create a game, so it cannot broadcast into the room that replaced it.

The command surface the console exposes for these messages, and what each command records, is documented in `DEV_CONSOLE.md`.

---

## Connection Lifecycle and Reconnect

On connect the gateway validates the room code, the session username, and that the username still has an account, then:

- registers the inbound handlers for that socket,
- parks the connection with `game-waiting` when the room has only one player, absorbing it into the session once the room completes,
- otherwise ensures the session exists, attaches the connection to its seat, and enters the [deck-selection phase](#deck-selection): once both seats are connected, each picks a deck, and the game starts — with those decks — when both selections are valid (broadcast `game-init`),
- answers a rejoin to a started session with the current `game-init` view, and a rejoin during selection with the current `game-deck-status`.

A connection that fails validation is answered with `game-error` and closed. A missing room code carries no code field; a missing username or a vanished account carries `unauthenticated`, which is how the client knows to log in again.

On disconnect the socket is detached from its seat and nothing else changes: the session, game, revision, and any open decision survive. Rejoining repeats the connect flow, and a started session answers with the current view instead of starting a new game. Two tabs are two connections on one seat and both receive every broadcast.

---

## Event Bridge

`eventBridge.js` subscribes to the session game's event bus as a post-phase observer, only through `EVT` constants. It handles engine events that must reach a player outside the action and decision response cycle. The first case is the hand-peek reveal: `HAND_PEEKED` is forwarded as a targeted `game-hand-peek` message to the observing seat's connections. Delivery failures are recorded on the emit result and never abort the authoritative event chain.

---

## Bot Seam

A bot controller is a future occupant of a seat and needs no socket:

- implement the connection interface (`send(event, payload)`),
- `session.attach(username, botConnection)` to occupy the seat,
- submit moves through the gateway's validated paths (`submitDeckSelect` for the pre-game pick, `submitAction` / `submitDecision` once started), which stamp identity, validate shape, and deliver rejections back through the bot's own `send`.

Because delivery is connection-agnostic in `GameSession`, a seat can hold a browser tab and a bot connection at the same time.

---

## Testing

`server/game/tests/net/` holds two layers of tests: unit suites with fake sockets for the gateway and sessions, and real-transport suites driven through `harness.js`, which boots the express app plus Socket.IO on an ephemeral port, authenticates players through the real login endpoint, and connects them with `socket.io-client`. See `TESTING.md`.
