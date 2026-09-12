# Authentication

A player is a username. Identity lives in the express-session, and a session is valid only while its username still has a record in the accounts file. Sessions come from one login page, there are no passwords, and the same validity rule is enforced at the HTTP gate, at `/auth/status`, and at the game socket, so no two boundaries can disagree about who is signed in.

## Accounts

`server/accounts/accountStore.js` owns `server/data/users.json` and its record shape: one empty object per username. It is the single declaration of that path, and both the gate and `server/routes/auth.js` go through it.

- `hasAccount(username)` answers whether a name exists. A blank or missing name is never an account, and an absent file reads as no accounts at all.
- `createAccountIfMissing(username)` returns whether it created the record, so the caller provisions exactly once per account.
- `removeAccount(username)` returns whether a record was there. Once it is gone, every session holding that name stops being authenticated.

The file is user-scoped runtime data and is gitignored. The store is built by a factory taking `filePath`, which is how tests point it at a temporary file.

## Routes

| Route | Behavior |
| ----- | -------- |
| `GET /login` | Serves the login page. It is the one page with no session gate, because it is where the gate sends everyone else. |
| `POST /auth/login` | Takes a username only. A name that has never been used creates the account and provisions the starter decks; an existing record is never provisioned twice. Answers `200 "Login successful"`, or `400` with the reason. Names are 3 to 18 characters of letters, digits, and underscores. |
| `GET /auth/status` | Answers `{ isAuthenticated, username }`. True only while the session name has a live record, which is what lets the navbar trust it. |
| `POST /auth/logout` | Destroys the session. |

## The session gate

`server/routes/authentication.js` exports `createAuthGate({ accounts })`, which returns two middlewares over one account check:

- `requireApiSession` answers `401` with `{ message: "Authentication required." }`.
- `requirePageSession` answers `302` to `/login?next=<encodeURIComponent(req.originalUrl)>`.

A request is authenticated only when `req.session.username` is a non-empty string with a live account record. A missing session and a session whose account was removed are the same case. Neither middleware touches the session, so a rejected cookie survives and logging in again simply overwrites the name. Each one catches its own failures and calls `next(error)`, because Express 4 does not forward a rejected promise from async middleware.

Route contracts:

| Contract | Routes |
| -------- | ------ |
| `requirePageSession` | `GET /play`, `GET /decks`, `GET /game/:roomCode` |
| `requireApiSession` | `GET /decks/data`, `POST /decks/validate`, `POST /decks`, `PUT /decks/:id`, `DELETE /decks/:id`, `POST /game/createRoom`, `POST /game/:roomCode/join` |
| No gate | `GET /login`, all `/auth/*`, and the read-only content surface: the home page, the cards page and its data route, the rules page and its content routes, plus the glossary, affiliation, position, and trait data routes |

Both route factories (`createGameRouter`, `createDecksRouter`) take a `gate` option defaulting to the shared instance, so a test can inject a gate over its own accounts file.

## The return path

`next` travels in the query string, which makes it attacker-controllable, so it is validated in exactly one place: `public/utils/auth-redirect.js`. `safeNextPath` accepts a single-slash same-origin relative path and rejects a scheme, a protocol-relative `//host`, a backslash, whitespace or control characters, and the login page itself, which would redirect in a loop. Anything else falls back to `/play`. The server never redirects to a caller-supplied URL: it only writes the requested URL into the redirect it sends, and the browser validates before navigating.

## Client behavior

- `authFetch(input, init)` is `fetch` for session-protected routes. It returns every response except a `401`, which starts the login redirect and returns a promise that never settles, so a caller's own failure message cannot flash while the page unloads. Every protected call site uses it; calls to the public surface keep plain `fetch`.
- `redirectToLogin()` sends the browser to `loginUrlFor(location)`, the same URL shape the page gate builds.
- `public/pages/login/` is the page and `login-form.js` holds its logic: a visitor who already has a session goes straight to the validated `next`, and a rejected login renders the server's own message rather than a rule duplicated in the browser.
- The game socket validates identity on connect. A rejection for a missing or vanished account carries `code: "unauthenticated"` (`ERROR_CODES` in `server/game/net/protocol.js`, mirrored in `public/game/protocol.js`), which the game page answers by disconnecting the socket and going to the login page; every other socket error keeps the existing alert. A server restart is the case that reaches this path, because the memory session store empties while the room record survives, so both seats log in again and return to the room.

## Tests

Route suites inject an identity through an `x-test-user` header and inject `createAuthGate({ accounts: createAccountStore({ filePath }) })` over a temporary accounts file, so no route test reads the accounts of the machine running it. `server/routes/authentication.test.js` covers both contracts and both rejection reasons, `server/routes/login.test.js` covers the page, and `server/game/tests/net/protocolParity.test.js` keeps `EVENTS` and `ERROR_CODES` equal between the two protocol copies. The net harness logs in for real (see `TESTING.md`), so those suites write `Alice` and `Bob` into `server/data/users.json`.
