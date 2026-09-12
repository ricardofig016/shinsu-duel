import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAuthRouter } from "./auth.js";
import { createAccountStore } from "../accounts/accountStore.js";
import { createDeckLibrary } from "../decks/deckLibrary.js";
import { provisionStarterDecks } from "../decks/deckProvisioning.js";

const TEMPLATES = [{ code: "starter", name: "Starter Deck", cards: ["ashen_knight", "brawn_idol", "cinder_skill"] }];

function makeTemp(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `shinsu-auth-${name}-`));
  return path.join(directory, `${name}.json`);
}

async function startApp() {
  const accountsPath = makeTemp("users");
  const accounts = createAccountStore({ filePath: accountsPath });
  const library = createDeckLibrary({ filePath: makeTemp("decks") });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: true }));
  app.use(
    "/auth",
    createAuthRouter({
      accounts,
      provisionDecks: (username) => provisionStarterDecks(username, { library, decks: TEMPLATES }),
    })
  );

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, library, accounts };
}

const login = (baseUrl, username) =>
  fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username }),
  });

describe("auth login provisioning", () => {
  let app;

  afterEach(async () => {
    if (app) await new Promise((resolve) => app.server.close(resolve));
    app = null;
  });

  test("a new account receives a copy of every starter deck", async () => {
    app = await startApp();

    const response = await login(app.baseUrl, "Alice");

    expect(response.status).toBe(200);
    expect(await app.accounts.hasAccount("Alice")).toBe(true);
    expect((await app.library.listDecks("Alice")).map((deck) => deck.name)).toEqual(["Starter Deck"]);
  });

  test("an existing account is never provisioned again", async () => {
    app = await startApp();
    await login(app.baseUrl, "Alice");
    const [deck] = await app.library.listDecks("Alice");
    await app.library.deleteDeck(deck.id, "Alice");

    const response = await login(app.baseUrl, "Alice");

    expect(response.status).toBe(200);
    expect(await app.library.listDecks("Alice")).toEqual([]);
  });

  test("a pre-existing user record is never provisioned", async () => {
    app = await startApp();
    await app.accounts.createAccountIfMissing("Legacy");

    const response = await login(app.baseUrl, "Legacy");

    expect(response.status).toBe(200);
    expect(await app.library.listDecks("Legacy")).toEqual([]);
  });

  test("logging in twice does not duplicate starter decks", async () => {
    app = await startApp();

    await login(app.baseUrl, "Alice");
    await login(app.baseUrl, "Alice");

    expect(await app.library.listDecks("Alice")).toHaveLength(1);
  });

  test("a failed provisioning rolls the account back so a later login retries it", async () => {
    const accounts = createAccountStore({ filePath: makeTemp("users") });
    const library = createDeckLibrary({ filePath: makeTemp("decks") });
    let fail = true;
    const expressApp = express();
    expressApp.use(express.json());
    expressApp.use(session({ secret: "test", resave: false, saveUninitialized: true }));
    expressApp.use(
      "/auth",
      createAuthRouter({
        accounts,
        provisionDecks: (username) => {
          if (fail) throw new Error("deck store unavailable");
          return provisionStarterDecks(username, { library, decks: TEMPLATES });
        },
      })
    );
    expressApp.use((error, req, res, next) => res.status(500).send("Login failed"));
    const server = expressApp.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    app = { server, baseUrl, library, accounts };

    const failed = await login(baseUrl, "Alice");
    expect(failed.status).toBe(500);
    // The account record is gone, so the failure is not remembered anywhere.
    expect(await accounts.hasAccount("Alice")).toBe(false);
    expect(await library.listDecks("Alice")).toEqual([]);

    fail = false;
    const retried = await login(baseUrl, "Alice");
    expect(retried.status).toBe(200);
    expect(await accounts.hasAccount("Alice")).toBe(true);
    expect((await library.listDecks("Alice")).map((deck) => deck.name)).toEqual(["Starter Deck"]);
  });

  test("rejects invalid usernames without creating anything", async () => {
    app = await startApp();

    const response = await login(app.baseUrl, "no");

    expect(response.status).toBe(400);
    expect(await app.library.listDecks("no")).toEqual([]);
  });
});
