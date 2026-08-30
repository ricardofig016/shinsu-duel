# Testing & Fixtures — Shinsu Duel

This document is the **entry point** for writing tests and creating test fixtures. It explains how the test suite is laid out, how tests get their cards, and the edit pipelines to follow.

---

## Run the tests

- **Full suite:** `npm run test` (wraps Jest with the required Node flags). Never use bare `npx jest` — it breaks ESM.
- **Focused:** `npm run test -- <pattern>` (e.g. `npm run test -- ModifierRuntimeIntegration`).
- Coverage is collected automatically to `coverage/`.

## Test layout

Tests live in `server/game/tests/`, mirroring the source tree under `server/game/` plus concern-based folders:

| Folder         | Holds                                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| `actions/`     | One test per action (`DeployUnitAction`, `PlaySkillAction`, …)                                           |
| `attributes/`  | Attribute engine tests (`AnimaEngine`, `HwayeomsaEngine`, …)                                             |
| `handlers/`    | One test per handler class                                                                               |
| `services/`    | Service unit tests (`PassiveManager`, `ModifierService`, `RequirementValidator`, …)                      |
| `core/`        | Engine components at `server/game/` root (`EventBus`, `GameState`, `ModifierStack`, `TargetResolver`, …) |
| `integration/` | Cross-component flows (evolution, triggers, modifiers, lifecycle, final actions)                         |
| `regression/`  | Regression suites keyed to a specific past bug                                                           |
| `replay/`      | `ReplayDriver` determinism                                                                               |
| `utils/`       | `SeededRng` and other shared utilities                                                                   |

The shared helper `tests/utils.js` lives at the tests root; subfolder tests import it as `../utils.js` and source modules as `../../…`. Use `git mv` for renames to preserve history.

### Shared helpers (`tests/utils.js`)

- `setupGameWithHands({ Alice: [...names], Bob: [...] })` — build a game with the named fixtures in each player's hand.
- `setupGameWithCardsInHand([...names])` — Alice holds the named cards; Bob gets a default deck.
- `createTestGame()` — empty two-player game with legal decks.
- `deployUnit(game, username, name, positionCode)` — deploy a unit from hand by name.
- `advanceToRound(game, round)`, `getCardIdByName(name)`, `createLegalDeck([...ids])`, `expectShinsuState(...)`.

### Frontend tests

Tests for browser utilities live in `public/tests/`, mirroring `public/` (e.g. `public/tests/utils/markdown.test.js` tests `public/utils/markdown.js`). They join the same suite as plain ESM and run in Node, so they must stay DOM-free; DOM behavior is verified in the browser.

---

## Card fixtures

Tests never read shipped card data. They resolve cards **only** against the test-owned catalog at `tests/fixtures/cards.js` (which imports the compiled artifact `tests/fixtures/cards.json`), injected via `GameState`'s `options.cards`. `CardDataAudit` and `DslCatalogContract` (shipped data + schema contracts) and `FixtureCardAudit` (fixture data) are the only tests that touch real files.

### Shipped-data audits

`CardDataAudit.test.js` audits `data/cards/` against `server/data/cards.json` on every run: fresh-compile parity, stable name-sorted ids, recursive DSL-catalog coverage, runtime handler ownership, and the artwork slug contract (every compiled `artworkPath` is absent or exactly `/assets/images/artworks/<normalizeName(name)>.png`). Its handler-coverage test is intentionally strict — it fails while a dispatchable `type` used by shipped cards has no registered handler. `DslCatalogContract.test.js` keeps `schemas/dsl-catalog.json` in lockstep with both JSON Schemas and the compiler's accepted vocabulary:

```powershell
npm run test -- CardDataAudit
npm run test -- DslCatalogContract
```

`FixtureCardAudit.test.js` enforces the fixture contract only; production audits never gate fixtures.

### Authoring workflow

Fixtures are **authored as YAML** in `tests/fixtures/yaml/{units,skills,equipments}/`, using the **same source shape as `data/cards/`**:

- positions/attributes/affiliations in display form (`"spear bearer"`, `"red witch"`, `"team sweet and sour"`).
- traits as strings with optional value (`strong 10`, `taunt`).
- `evolve:` / `ignition:` as raw trigger strings, exactly like real cards.

Run `npm run compile:fixtures` to normalize and schema-validate them through the real compiler (`scripts/compile-fixtures.js` reuses `compileCard`/`cleanCompiled`/`resolveEvolve*`/`resolveIgnite*` from `card-compile.js`) and regenerate `tests/fixtures/cards.json`. **Never hand-edit the compiled JSON** — the compiler is the single path from YAML source to artifact.

Id assignment:

- Generic fillers keep ids **1–40** (generated in code, never authored).
- Named fixtures are name-sorted and assigned **10000+** by the compiler, mirroring `card-compile.js`.

One deliberate deviation from `card-compile.js`:

- `card-validate.js` domain rules (rank→cost ranges, kind/position/line/rule constraints) do not apply — fixtures deliberately exercise edge shapes.

### Conventions (enforced by `FixtureCardAudit.test.js`)

- Named fixtures use compiler-assigned ids **10000+** (name-sorted) with a `Test` prefix (e.g. `Test Scout`); they mirror the mechanics a test exercises. Exact-name exceptions follow the shipped engines that resolve them: `Fire Core` (`HwayeomsaEngine`) and `Conduit` (`JeonsulsaEngine` looks it up by name via `findCardsByName`).
- Generic fillers use ids **1–40** and MUST keep the lowest ids: JS integer-like object keys sort numerically, so `createLegalDeck` slices them first and default decks contain only fillers. They are generated in `compile-fixtures.js` (`buildFillers`), not authored as YAML.
- Fillers exist so every test can build a **legal 30-card deck** (RULES.md) without leaking named fixtures into default decks. They are inert (`Test Filler N`, cost 1, hp 3, regular, fisherman, no abilities/passives).
- `Fire Core` keeps its exact name (`HwayeomsaEngine` hardcodes it); `series: "incinerate"` / `"thorn-fragment"` are kept so engines resolve them structurally.
- Structural codes (`series`, trait/position/affiliation/attribute codes) reuse the shipped catalog vocabulary (`server/data/*.json`).

`FixtureCardAudit.test.js` validates the compiled `cards.json` against `schemas/compiled-cards.schema.json`, checks id/name uniqueness, resolves codes against the shipped vocab, asserts ≥30 eligible cards, checks transformation cross-references, and forbids `custom`/`handler` DSL.

---

## Edit pipelines

### Write a new test

1. Pick the folder from the layout table (mirror the source file's home, or use `integration/`/`regression/` for cross-component/bug-specific coverage).
2. Import helpers from `../utils.js` and fixtures by name via `getCardIdByName(...)`.
3. Build the board with `setupGameWithHands` + `deployUnit` (or `createTestGame`), then drive actions via `game.processAction({ type, data })`.

### Create a fixture card

1. Add a YAML file in `tests/fixtures/yaml/<type plural>/` with a unique `Test`-prefixed name.
2. Run `npm run compile:fixtures` (fails with a precise schema error if the shape is wrong).
3. Reference it by name in tests via `getCardIdByName("Test …")`.

### Edit a fixture card

1. Edit its YAML (never `cards.json`).
2. Run `npm run compile:fixtures`.
3. Run the affected focused tests, then `npm run test`.

### Fix a bug

1. Fix the underlying cause first.
2. Add a regression test in `tests/regression/` (or the matching folder) that would have failed before the fix, covering the specific failure mode plus edge cases where practical.
3. Focused tests, then `npm run test`.

---

## Key files

| File                                                  | Role                                              |
| ----------------------------------------------------- | ------------------------------------------------- |
| `server/game/tests/utils.js`                          | Shared test helpers (deck/game construction)      |
| `server/game/tests/fixtures/yaml/**`                  | Fixture source (YAML, same shape as `data/cards`) |
| `server/game/tests/fixtures/cards.json`               | Compiled fixture artifact (generated)             |
| `server/game/tests/fixtures/cards.js`                 | Thin importer of `cards.json` + `byName`          |
| `server/game/tests/fixtures/FixtureCardAudit.test.js` | Fixture contract/audit gate                       |
| `scripts/compile-fixtures.js`                         | Fixture compiler (`npm run compile:fixtures`)     |
| `scripts/card-compile.js`                             | Shared compiler primitives (reused by fixtures)   |
| `schemas/compiled-cards.schema.json`                  | The compiled contract fixtures must satisfy       |
