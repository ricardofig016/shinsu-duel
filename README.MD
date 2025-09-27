# Shinsu Duel

Shinsu Duel is a 1v1 collectible card game (CCG) inspired by SIU's [Tower of God](https://en.wikipedia.org/wiki/Tower_of_God). Players strategize by building decks, deploying units, and using abilities to destroy the opponent's lighthouses.

The project is intended for local development and experimentation. It is not production-hardened.

## Table of contents

- [Shinsu Duel](#shinsu-duel)
  - [Table of contents](#table-of-contents)
  - [Key Features](#key-features)
  - [Quick access](#quick-access)
  - [Requirements](#requirements)
  - [Install](#install)
  - [Environment](#environment)
  - [Development](#development)
  - [Playing](#playing)
  - [Running tests](#running-tests)
  - [How the game runs](#how-the-game-runs)
    - [EventBus](#eventbus)
      - [How it works](#how-it-works)
    - [Important server files](#important-server-files)
  - [Project structure](#project-structure)
    - [Important folders](#important-folders)
    - [Full structure](#full-structure)
  - [Notes \& assumptions](#notes--assumptions)
  - [License](#license)

## Key Features

- Turn-based 1v1 CCG
- Server-side game state (`GameState`)
- Real-time gameplay using Socket.io
- REST API endpoints to browse cards, positions, traits and manage rooms
- Jest testing for server-side game logic

## Quick access

- Server entry: `server/app.js`
- WebSocket: `server/game/websocket.js`
- Game engine: `server/game/GameState.js`
- Client: `public/`

## Requirements

- Node.js
- npm

## Install

Clone the repository and install dependencies:

```powershell
git clone https://github.com/ricardofig016/shinsu-duel.git
cd shinsu-duel
npm install
```

## Environment

The server uses a session secret if provided. Create a `.env` file in the project root to customize environment variables (optional):

```plaintext
SESSION_SECRET=your_secret_here
```

If `SESSION_SECRET` is not provided, a random secret will be generated at runtime.

## Development

Run the server in development mode (auto-restarts on changes):

```powershell
npm run dev
```

Then open http://localhost:3000 in your browser. The server serves the static client from `public/` and provides REST routes under `/`.

## Playing

Currently, the best way to try out the game (against yourself), is to open http://localhost:3000/game/NK5JOF (test room) on two tabs, at least one of these tabs must be anonymous.

This is because the server requires 2 tabs that don't share a session/cookies. The server will assign 2 tester usernames to prevent the hassle of authentication during development.

Check out the game's rules at http://localhost:3000/rules.

## Running tests

The project includes Jest unit tests for server-side game logic. Run the tests with:

```powershell
npm test
```

Test reports are also generated under `reports/` and code coverage under `coverage/` when tests are executed.

## How the game runs

- Clients join a room and connect to the Socket.io namespace `/game` with a `roomCode` query parameter.
- When two players are connected to the same room, the server initializes a `GameState` instance for that room.
- Clients send `game-action` events with an action object; the server validates and applies actions using the action registry and publishes updates back to clients (`game-init`, `game-update`, `game-error`).

### EventBus

The server uses an `EventBus` instance (created per `GameState`) to decouple game logic. The `EventBus` is a publish/subscribe system that lets subsystems react to game lifecycle events without tight coupling.

#### How it works

- Publishers: `GameState` and action handlers publish events such as `OnGameStart`,`OnRoundStart`, `OnUnitDeployed`, etc.
- Subscribers: Effects, passive abilities, and the `Logger` subscribe to these events. For example, an effect that draws a card at turn end will subscribe to `OnTurnEnd` and perform its logic when the event is published.
- Lifecycle: Effects or passive abilities that register event handlers should also unsubscribe (or be removed) when they are no longer active. The `GameState` tracks active effects and will call their cleanup/unsubscribe methods when the effect is removed.

### Important server files

- `server/game/GameState.js`: authoritative game state and rules (round/turn management, draw, shinsu, effects).
- `server/game/websocket.js`: socket handlers, game lifecycle and broadcasting.
- `server/routes/`: REST endpoints for cards, positions, rules, rooms, and authentication.

## Project structure

### Important folders

- `server/`: Express server, routes, game engine and websocket wiring
  - `server/game/`: Game engine classes (GameState, Card, Unit, Actions, Abilities, registries, tests)
  - `server/routes/`: Router modules used by the client
  - `server/data/`: JSON data used to seed cards, positions, traits
- `public/`: Static client files (HTML/CSS/JS) and UI components

### Full structure

```plaintext
shinsu-duel/
├── README.md
├── TODO.md
├── coverage/
├── docs/
├── jest.config.mjs
├── node_modules/
├── nodemon.json
├── package-lock.json
├── package.json
├── public/
│ ├── assets/
│ ├── components/
│ │ ├── navbar/
│ │ │ ├── index.html
│ │ │ ├── script.js
│ │ │ └── styles.css
│ │ ├── tooltip/
│ │ │ ├── index.html
│ │ │ ├── script.js
│ │ │ └── styles.css
│ │ ├── unit-card-horizontal/
│ │ │ ├── index.html
│ │ │ ├── script.js
│ │ │ └── styles.css
│ │ └── unit-card-vertical/
│ │ ├── index.html
│ │ ├── script.js
│ │ └── styles.css
│ ├── favicon.ico
│ ├── global.css
│ ├── index.css
│ ├── index.html
│ ├── index.js
│ ├── pages/
│ │ ├── game/
│ │ │ ├── index.html
│ │ │ ├── script.js
│ │ │ └── styles.css
│ │ ├── play/
│ │ │ ├── index.html
│ │ │ ├── script.js
│ │ │ └── styles.css
│ │ └── rules/
│ │ ├── index.html
│ │ ├── script.js
│ │ └── styles.css
│ └── utils/
│ ├── card-util.js
│ └── component-util.js
├── reports/
├── server/
│ ├── app.js
│ ├── data/
│ │ ├── affiliations.json
│ │ ├── attributes.json
│ │ ├── cards.json
│ │ ├── positions.json
│ │ ├── rooms.json
│ │ ├── traits.json
│ │ └── users.json
│ ├── game/
│ │ ├── Ability.js
│ │ ├── ActionHandler.js
│ │ ├── Card.js
│ │ ├── EventBus.js
│ │ ├── GameState.js
│ │ ├── Logger.js
│ │ ├── PassiveAbility.js
│ │ ├── Unit.js
│ │ ├── abilities/
│ │ │ └── CreateOneLighthouse.js
│ │ ├── actions/
│ │ │ ├── AddLighthousesAction.js
│ │ │ ├── DeployUnitAction.js
│ │ │ ├── PassTurnAction.js
│ │ │ └── UseAbilityAction.js
│ │ ├── effects/
│ │ │ ├── continuous/
│ │ │ │ ├── DrawCardTurnEnd.js
│ │ │ │ └── TestConsoleLogOnTurnEndUntilRoundEnd.js
│ │ │ └── triggered/
│ │ │ └── TestConsoleLogOnTurnEnd.js
│ │ ├── passive_abilities/
│ │ │ └── RoundEndTakeOneDamage.js
│ │ ├── registries/
│ │ │ ├── abilityRegistry.js
│ │ │ ├── actionRegistry.js
│ │ │ ├── effectRegistry.js
│ │ │ └── passiveAbilityRegisttry.js
│ │ ├── tests/
│ │ │ ├── GameState.test.js
│ │ │ ├── actions/
│ │ │ │ ├── DeployUnitAction.test.js
│ │ │ │ └── UseAbilityAction.test.js
│ │ │ ├── passive_abilities/
│ │ │ │ └── RoundEndTakeOneDamage.test.js
│ │ │ └── utils.js
│ │ └── websocket.js
│ ├── logs/
│ ├── routes/
│ │ ├── affiliations.js
│ │ ├── auth.js
│ │ ├── cards.js
│ │ ├── game.js
│ │ ├── play.js
│ │ ├── positions.js
│ │ ├── router.js
│ │ ├── rules.js
│ │ └── traits.js
│ └── utils/
│ └── file-util.js
└── tree.txt
```

## Notes & assumptions

- The server is configured for local development. Cookie `secure` is false in `express-session`.
- The game engine expects 2 players per room and will ignore extra connections.
- Card/position data is stored in JSON files under `server/data/` and loaded by the engine.

## License

MIT - see `LICENSE.md`
