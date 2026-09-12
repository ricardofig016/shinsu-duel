# Deck Collection — Shinsu Duel

This document describes the deck collection: user-owned decks, the starter decks every account receives, the legality contract shared with the engine, the `/decks` REST surface, and the decks page.

---

## Deck model and storage

A deck is `{ id, owner, name, cards, updatedAt }`: a named list of card **slugs** (copies allowed) owned by one user. The slug (`normalizeName(name)`, stamped into every compiled card) is a card's persistent identifier; the runtime cardId is a name-sorted compile-time index that shifts whenever the catalog changes, so nothing in the collection may store it. The boundary between stored decks and the engine (a deck starting a game) resolves slugs to cardIds through the compiled catalog. Decks live in `server/data/decks.json`, a runtime file like `rooms.json` and `users.json` (gitignored, created on first read). `server/decks/deckLibrary.js` owns storage; every read and write is owner-scoped.

The library owns record shape only. Deck rules live in two places that share their constants with the engine, never in routes or clients.

## Deck rules: buildable versus legal

RULES.md fixes the deck contract: exactly 30 cards, up to 3 copies of each card, Unreachable excluded. On top of that, test cards (the `_Test*` entries of the compiled catalog, classified in `server/utils/test-card.js`) can only be used in dev rooms.

- **Buildable** — every slug resolves in the compiled catalog, so the engine could construct the cards at all.
- **Legal** — buildable, exactly 30 cards, at most 3 copies per card, no Unreachable cards, no test cards.

The engine enforces the rules when a game is constructed. `GameState.#buildDeckFromCardIds` rejects anything illegal under the default strict mode, and `GameState.getDeckPoolCardIds` (the pool dealt decks are built from) contains only deck-legal cards, so default decks always satisfy the full contract. A game constructed with the `enforceDeckRules` option set to false applies only the buildable contract — size, copy limit, Unreachable, and test-card checks are skipped — which is how a dev room starts with an illegal deck. The mode is recorded in the replay artifact's `InitialState` metadata (`meta.enforceDeckRules`) and restored by `ReplayDriver`, so a dev game reconstructs byte-for-byte. `server/decks/deckValidation.js` (`validateDeckCards`) computes the same contract for the collection, reading `GameState.INIT_DECK_SIZE` and `GameState.MAX_CARD_COPIES` instead of copying them.

Decks may be **saved with rule violations** (they are flagged with per-violation problems and stay out of non-dev games), but never with unbuildable card lists: no room type can start a game with them. Legality is recomputed on every read, because the compiled catalog can change between saves. The deck-to-engine boundary lives in `server/utils/card-catalog.js` (`buildSlugIndex` / `getCardIdBySlug`): the gateway converts the stored slugs to runtime cardIds when a game is created, and re-checks buildability and legality there, so a deck edited or deleted between pick and start cannot reach the engine.

**Stored order is not the draw order.** A deck's card list is kept exactly as the builder saved it (so editing a deck never reshuffles it), and `createSeededGame` shuffles every dealt deck — explicit and default alike — with the room seed before construction. A player therefore cannot control their own draw order by arranging their list, and a fixed seed reproduces the same deal deterministically.

## Starting a game with a deck

The pre-game deck-selection phase on the game page is owned by the net gateway; its flow, gating, and `game-deck-select` / `game-deck-status` messages are documented in `NET_PROTOCOL_ARCHITECTURE.md`. The page's data comes from this collection:

- the picker lists the caller's decks from `GET /decks/data`, so each option already carries `legal` and `problems`; illegal decks are disabled in normal rooms and selectable behind a warning marker in dev rooms (`dev` in the selection status, from `isDevRoomCode`),
- the pure helpers behind the picker live in `public/pages/game/deckStep.js` (see its header doc),
- at start the gateway resolves the picks through the deck library and the compiled catalog and hands the engine `{ decks, enforceDeckRules }` (see the buildable-versus-legal contract above).

## Starter decks

`server/data/starter-decks.json` holds the curated templates, authored **by card slug**; `server/decks/starterDecks.js` validates every slug against the compiled catalog at load and fails loudly on one that no longer resolves (as after a card rename). `server/decks/deckProvisioning.js` copies every template into a new account inside `createUser` (`server/routes/auth.js`), once, at creation: there is no lazy or legacy provisioning, so a user who deletes every deck keeps an empty collection. A failure part-way through provisioning removes the copies already created. Copies are ordinary decks.

## REST surface

`server/routes/decks.js` mirrors the cards route split: `GET /decks` serves the page, the JSON API lives beside it. All API routes require a session (`isAuthenticated`, shared from `server/routes/authentication.js`) and are scoped to the session user.

| Route | Behavior |
| ----- | -------- |
| `GET /decks/data` | `{ decks: [...], limits }` — the caller's decks, each `{ id, name, cards, updatedAt, buildable, legal, problems }`, plus the deck-construction numbers clients render with (`deckSize`, `maxCardCopies`, `maxNameLength`). |
| `POST /decks/validate` | `{ buildable, legal, problems }` for an unsaved card list; the page's live feedback source. |
| `POST /decks` | Create; 400 with the problem when the name is invalid or the list is unbuildable; rule violations save fine. |
| `PUT /decks/:id` | Update; 404 for a missing or foreign deck. |
| `DELETE /decks/:id` | Remove; 404 for a missing or foreign deck. |

The name-limit message is worded from `MAX_DECK_NAME_LENGTH` in `deckValidation.js`; clients derive their copy of the message from the `limits` payload rather than restating the number.

## Decks page

`public/pages/decks/` has two views.

**Deck list** — a table with one row per deck: a fan of the deck's three most expensive distinct units (cheapest left, most expensive right and frontmost, rendered as the shared card component; right-click opens the big card), name, size, composition (units / skills / equipment), average card cost, legality flag (hover shows the problems), last update, and Edit / Duplicate / Delete actions. Clicking the row opens the deck. Filters: name search, legality (all / legal / not legal), sorting (name and size, both directions), and a "containing cards" filter — text, type, and affiliation criteria applied to the deck's contents where each active facet is satisfied independently by some card in the deck.

**Builder** — the deck contents panel (names, +/-, live problems from `/decks/validate`, size counter, save state) beside the catalog pool: the same card grid the cards page renders, through the shared modules `public/utils/card-grid.js` and `public/utils/catalog-toolbar.js` (see their header docs for the mount-once / update-in-place contract). Each pool card carries a copy-count badge and +/- buttons; left-click adds a copy, right-click opens the big card. "Show illegal" reveals Unreachable cards; "In deck only" narrows the pool to picked cards. The pool sorts by the standard catalog orders (name or cost, both directions), with name ascending as the default, so adding or removing copies never reorders the grid. With `?dev=true` test cards join the pool inline and the copy cap disappears — the server still flags whatever breaks the rules. Leaving the builder with unsaved edits asks for confirmation.

Rule numbers shown by the page come from the `limits` payload; the client keeps built-in values only as fallbacks and never decides legality.
