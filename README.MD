# Shinsu Duel

Shinsu Duel is a local 1v1 collectible card game inspired by SIU's [Tower of God](https://en.wikipedia.org/wiki/Tower_of_God). Players build decks, deploy units, use abilities, and attack opposing lighthouses.

The project is an active game-engine rebuild. The server and client are suitable for local development, not production deployment.

## Quick start

Requirements: Node.js 20 or newer and npm.

Install dependencies:

```powershell
git clone https://github.com/ricardofig016/shinsu-duel.git
cd shinsu-duel
npm install
```

Start the development server:

```powershell
npm run dev
```

Open http://localhost:3000. The rules page is available at http://localhost:3000/rules.

Optional environment configuration:

The server uses a session secret if provided. Create a `.env` file in the project root to customize environment variables (optional):

```plaintext
SESSION_SECRET=your_secret_here
```

If `SESSION_SECRET` is omitted, the server generates a random secret at startup.

## Card data workflow

Source cards are YAML files in `data/cards/`. Test cards beginning with `_test_` are intentionally included in the production compilation set.

The source and generated schemas are separate:

- `schemas/card.schema.json` validates source YAML.
- `schemas/compiled-cards.schema.json` validates generated JSON.
- `server/data/cards.json` is generated runtime data; do not edit it by hand.

Validate source cards:

```powershell
npm run validate:cards
```

Compile and validate runtime card data:

```powershell
npm run compile:cards
```

The compiler validates YAML before reading any cards, compiles recognized common effects into DSL objects, preserves source text in each `raw` field, and retains unsupported effects as `custom` entries for later handlers. Evolution and ignition are optional; a non-empty source trigger must have its exact target card.

## Tests

Run the Jest suite:

```powershell
npm test
```

Reports are written to `reports/`; coverage is written to `coverage/`.

## Important paths

- `server/app.js`: Express entry point.
- `server/game/GameState.js`: authoritative game state.
- `server/game/EventBus.js`: game event publication and subscriptions.
- `server/game/websocket.js`: Socket.IO game transport.
- `server/routes/`: REST routes.
- `public/`: static client.
- `RULES.md`: current game rules.
- `PROJECT_RESURRECTION_PLAN.md`: phased engine rebuild plan.

The server creates one `GameState` per room. Clients connect to the `/game` Socket.IO namespace with a room code and send validated game actions.

## License

MIT - see `LICENSE.md`
