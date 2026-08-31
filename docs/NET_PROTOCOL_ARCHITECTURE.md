# Net Protocol Architecture — Shinsu Duel

This document describes the net layer: the session core, the wire protocol, the socket gateway, and the event bridge that connect the browser to the authoritative engine.

---

## Overview

The layer lives in `server/game/net/` and has one job per module:

| Module                | Responsibility                                                                       |
| --------------------- | ------------------------------------------------------------------------------------ |
| `GameSession.js`      | One live game: two seats, the players' connections, the `GameState`, revision counter |
| `SessionRegistry.js`  | Maps room codes to sessions; sessions live until the process exits                   |
| `protocol.js`         | Owns every event name and payload builder; builders are pure                          |
| `socketGateway.js`    | Binds Socket.IO to sessions; validates every inbound message                          |
| `eventBridge.js`      | Forwards engine events that must reach a player outside the action cycle              |

`server/createGameServer.js` assembles the express app, the HTTP server, Socket.IO, and the gateway. Its collaborators (session registry, room lookup, game factory, file logging) are injectable; `server/app.js` is the production entry that calls it with defaults, and the test harness boots the same factory with test doubles.

---

## Session and Seat Model

A `GameSession` is created on demand when both seats of a room hold a connection, and creation is idempotent: the first request wins, later requests return the same session. The session owns:

- two seats identified by username, taken from the room record's player list,
- one `GameState`, created exactly once through the injected `createGame` factory when the second seat connects,
- a monotonic revision counter (see below).

A **seat** holds that player's current connections in a set. A **connection** is anything with `send(event, payload)` (sockets also get `close`). One player can play from several tabs because every tab is just another connection on the same seat, and a future bot controller occupies a seat the same way without a socket (see [Bot Seam](#bot-seam)). `attach`/`detach` are idempotent, and `isFull()`/`isEmpty()` describe seat occupancy.

Sessions are never deleted on disconnect. They live until the process exits, so a dropped player rejoins the exact game, open decision included. This matches the express-session memory store, which also does not survive a restart.

---

## Protocol Events

All names come from `EVENTS` in `protocol.js`; the net layer contains no raw event-name literals. Reserved transport names (`connection`, `disconnect`) are listed separately in `TRANSPORT_EVENTS`.

| Event                 | Direction        | Sent when                                                                      |
| --------------------- | ---------------- | ------------------------------------------------------------------------------ |
| `game-action`         | client → server  | player action (deploy, pass, ability, skill, equipment, position switch, ...)   |
| `game-decision`       | client → server  | resolving a pending decision                                                    |
| `game-state-request`  | client → server  | asking for the current view (transport reconnect, manual refresh)               |
| `game-init`           | server → client  | game start, rejoin to a started session, answer to a state request              |
| `game-update`         | server → client  | after each accepted action or decision, broadcast to every seat                 |
| `game-error`          | server → client  | a rejected message; delivered to the sender only                                |
| `game-over`           | server → client  | the action that ends the game, and again for any action sent after game over    |
| `game-waiting`        | server → client  | a lone player in an unfinished room, or a state request before the game exists  |
| `game-hand-peek`      | server → client  | a hand-peek reveal, delivered to the peeking player's connections only          |

### Payloads

Every payload is built in `protocol.js` and builders return the exact object on the wire:

- `buildStateView({ game, revision, username })` wraps `GameState.getClientState(username)` with the session revision. The shape of that per-username view (hidden opponent hand, owner-only pending decision, condition magnitudes, runtime traits, equipment, granted abilities, positions) is documented in `GAMESTATE_ARCHITECTURE.md`.
- `buildError(message)` returns `{ message }`.
- `buildGameOverResult(gameOver)` returns `{ winner, reason }`.
- `buildWaitingPayload()` returns the fixed waiting message.
- `buildHandPeek(peek)` returns an independent copy of the reveal.

The client mirrors the event names in `public/game/protocol.js` and builds its outbound payloads through `public/game/actions.js`; client and server ship together, so there is no wire compatibility layer.

---

## Revision Semantics

The revision counter starts at 0 and is bumped:

- by 1 when the session's game is created,
- by 1 for each accepted player action,
- by 1 for each accepted decision.

Rejected input never bumps the counter, so a client comparing revisions can tell whether it has missed a snapshot. Every outbound snapshot (`game-init` and `game-update`) carries the session's current revision.

---

## Inbound Validation

Both inbound paths funnel through the gateway before anything reaches the engine:

1. **Shape validation.** Actions must be `{ type, data }` with a non-empty string type and a plain-object data payload; decisions must be `{ decisionId, choices }` with a non-empty string id and an array of choices. Anything else is answered with a `game-error` ("Malformed action/decision payload.") and never reaches the engine.
2. **Identity stamping.** The connection's authenticated username is written onto the action; a payload claiming another player is ignored.
3. **State guards.** Messages before the game starts are answered with `game-waiting`; messages after game over are answered with the `game-over` result and leave the state untouched.
4. **Engine rejection.** Engine throws (unknown action type, wrong turn, invalid choices, foreign decision id, ...) are forwarded as `game-error` to the sender; the revision and state stay unchanged.

Accepted actions and decisions broadcast a `game-update` per seat, preceded by `game-over` when the move ended the game.

Identity comes from the express-session username. `createGameServer` shares its session middleware with the Socket.IO engine (`io.engine.use`), so the handshake cookie authenticates the socket; the room record must list that username as a participant. Room creation and joining stay on the existing REST endpoints.

---

## Connection Lifecycle and Reconnect

On connect the gateway validates the room code and the authenticated username against the room registry, then:

- registers the inbound handlers for that socket,
- parks the connection with `game-waiting` when the room has only one player, absorbing it into the session once the room completes,
- otherwise ensures the session exists, attaches the connection to its seat, and either starts the game (both seats connected, broadcast `game-init`) or answers with the current `game-init` view when the session is already started.

On disconnect the socket is detached from its seat and nothing else changes: the session, game, revision, and any open decision survive. Rejoining repeats the connect flow, and a started session answers with the current view instead of starting a new game. Two tabs are two connections on one seat and both receive every broadcast.

---

## Event Bridge

`eventBridge.js` subscribes to the session game's event bus as a post-phase observer, only through `EVT` constants. It handles engine events that must reach a player outside the action and decision response cycle. The first case is the hand-peek reveal: `HAND_PEEKED` is forwarded as a targeted `game-hand-peek` message to the observing seat's connections. Delivery failures are recorded on the emit result and never abort the authoritative event chain.

---

## Bot Seam

A bot controller is a future occupant of a seat and needs no socket:

- implement the connection interface (`send(event, payload)`),
- `session.attach(username, botConnection)` to occupy the seat,
- submit moves through the gateway's validated paths (`submitAction` / `submitDecision`), which stamp identity, validate shape, and deliver rejections back through the bot's own `send`.

Because delivery is connection-agnostic in `GameSession`, a seat can hold a browser tab and a bot connection at the same time.

---

## Testing

`server/game/tests/net/` holds two layers of tests: unit suites with fake sockets for the gateway and sessions, and real-transport suites driven through `harness.js`, which boots the express app plus Socket.IO on an ephemeral port, authenticates players through the real login endpoint, and connects them with `socket.io-client`. See `TESTING.md`.
