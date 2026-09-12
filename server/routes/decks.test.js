import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDecksRouter } from "./decks.js";
import { createDeckLibrary } from "../decks/deckLibrary.js";
import { createAccountStore } from "../accounts/accountStore.js";
import { createAuthGate } from "./authentication.js";
import GameState from "../game/GameState.js";
import { cards } from "../game/tests/fixtures/cards.js";

const eligibleSlugs = GameState.getEligibleCardIds(cards).map((cardId) => cards[cardId].slug);
const legalDeck = () => eligibleSlugs.slice(0, GameState.INIT_DECK_SIZE);

// The session username comes from a test header, so each request can act as
// any user without juggling cookies. Accounts live in a temporary file, so the
// gate never reads the runtime accounts of the machine running the tests.
const TEST_ACCOUNTS = { Alice: {}, Bob: {} };

function startApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-decks-route-"));
  const library = createDeckLibrary({ filePath: path.join(directory, "decks.json") });
  const accountsPath = path.join(directory, "users.json");
  fs.writeFileSync(accountsPath, JSON.stringify(TEST_ACCOUNTS, null, 2));
  const gate = createAuthGate({ accounts: createAccountStore({ filePath: accountsPath }) });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) req.session.username = req.headers["x-test-user"];
    next();
  });
  app.use("/decks", createDecksRouter({ library, catalog: cards, gate }));

  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once("listening", () => resolve({ server, library, baseUrl: `http://127.0.0.1:${server.address().port}` }));
  });
}

describe("decks route", () => {
  let app;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app = null;
  });

  const as = (user) => ({ "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) });
  const get = (user, url) => fetch(`${app.baseUrl}${url}`, { headers: as(user) });
  const send = (user, url, method, body) =>
    fetch(`${app.baseUrl}${url}`, { method, headers: as(user), body: JSON.stringify(body) });

  test("lists only the session user's decks", async () => {
    await app.library.createDeck({ owner: "Alice", name: "Alice Deck", cards: ["ashen_knight"] });
    await app.library.createDeck({ owner: "Bob", name: "Bob Deck", cards: ["brawn_idol"] });

    const response = await get("Alice", "/decks/data");

    expect(response.status).toBe(200);
    expect((await response.json()).decks.map((deck) => deck.name)).toEqual(["Alice Deck"]);
  });

  test("carries the deck-construction limits the page renders with", async () => {
    const payload = await (await get("Alice", "/decks/data")).json();

    expect(payload.limits).toEqual({
      deckSize: GameState.INIT_DECK_SIZE,
      maxCardCopies: GameState.MAX_CARD_COPIES,
      maxNameLength: 40,
    });
  });

  test("creates a legal deck and reports its validity", async () => {
    const response = await send("Alice", "/decks", "POST", { name: "  My Deck  ", cards: legalDeck() });

    expect(response.status).toBe(201);
    const { deck } = await response.json();
    expect(deck).toMatchObject({ name: "My Deck", buildable: true, legal: true, problems: [] });
    expect(deck.cards).toEqual(legalDeck());
    expect(await app.library.listDecks("Alice")).toHaveLength(1);
  });

  test("saves a deck with rule violations and flags it", async () => {
    const shortDeck = legalDeck().slice(0, 29);

    const response = await send("Alice", "/decks", "POST", { name: "Illegal", cards: shortDeck });

    expect(response.status).toBe(201);
    const { deck } = await response.json();
    expect(deck.buildable).toBe(true);
    expect(deck.legal).toBe(false);
    expect(deck.problems).toEqual([`A deck must contain exactly ${GameState.INIT_DECK_SIZE} cards; this one has 29.`]);
    expect(await app.library.listDecks("Alice")).toHaveLength(1);
  });

  test("rejects a deck holding unknown card slugs", async () => {
    const deck = [...legalDeck()];
    deck[0] = "not_a_card";

    const response = await send("Alice", "/decks", "POST", { name: "Broken", cards: deck });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Deck contains cards that do not exist.",
      problems: ['Card "not_a_card" does not exist.'],
    });
    expect(await app.library.listDecks("Alice")).toEqual([]);
  });

  test("rejects a missing or oversized name", async () => {
    expect((await send("Alice", "/decks", "POST", { name: "   ", cards: legalDeck() })).status).toBe(400);
    expect((await send("Alice", "/decks", "POST", { name: "x".repeat(41), cards: legalDeck() })).status).toBe(400);
    expect(await app.library.listDecks("Alice")).toEqual([]);
  });

  test("updates a deck through a full round trip", async () => {
    const created = await (
      await send("Alice", "/decks", "POST", { name: "First", cards: legalDeck() })
    ).json();

    const updated = await send("Alice", `/decks/${created.deck.id}`, "PUT", { name: "Second", cards: legalDeck().slice(0, 29) });

    expect(updated.status).toBe(200);
    const { deck } = await updated.json();
    expect(deck).toMatchObject({ id: created.deck.id, name: "Second", legal: false });

    const listed = await (await get("Alice", "/decks/data")).json();
    expect(listed.decks).toHaveLength(1);
    expect(listed.decks[0]).toMatchObject({ name: "Second", legal: false });
  });

  test("never reaches another user's deck", async () => {
    const created = await (
      await send("Alice", "/decks", "POST", { name: "Alice Deck", cards: legalDeck() })
    ).json();

    const put = await send("Bob", `/decks/${created.deck.id}`, "PUT", { name: "Stolen", cards: legalDeck() });
    const del = await send("Bob", `/decks/${created.deck.id}`, "DELETE", undefined);

    expect(put.status).toBe(404);
    expect(del.status).toBe(404);
    const aliceDecks = await (await get("Alice", "/decks/data")).json();
    expect(aliceDecks.decks[0]).toMatchObject({ name: "Alice Deck" });
    expect((await (await get("Bob", "/decks/data")).json()).decks).toEqual([]);
  });

  test("deletes the session user's own deck", async () => {
    const created = await (
      await send("Alice", "/decks", "POST", { name: "Doomed", cards: legalDeck() })
    ).json();

    const response = await send("Alice", `/decks/${created.deck.id}`, "DELETE", undefined);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(await app.library.listDecks("Alice")).toEqual([]);
    expect((await send("Alice", `/decks/${created.deck.id}`, "DELETE", undefined)).status).toBe(404);
  });

  test("validates a card list without saving it", async () => {
    const response = await send("Alice", "/decks/validate", "POST", { cards: legalDeck() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ buildable: true, legal: true, problems: [] });
    expect(await app.library.listDecks("Alice")).toEqual([]);
  });

  test("refuses every deck API request without a session", async () => {
    const listed = await get(null, "/decks/data");
    const created = await send(null, "/decks", "POST", { name: "Anon", cards: legalDeck() });
    const validated = await send(null, "/decks/validate", "POST", { cards: legalDeck() });

    expect(listed.status).toBe(401);
    expect(created.status).toBe(401);
    expect(validated.status).toBe(401);
    expect(await created.json()).toEqual({ message: "Authentication required." });
    expect(await app.library.listDecks("Alice")).toEqual([]);
  });

  test("redirects an anonymous visitor away from the decks page", async () => {
    const response = await fetch(`${app.baseUrl}/decks`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?next=%2Fdecks");
  });

  test("refuses a request from a session whose account is gone", async () => {
    const response = await get("Nobody", "/decks/data");

    expect(response.status).toBe(401);
  });
});
