import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAuthRouter } from "./auth.js";
import { createDeckLibrary } from "../decks/deckLibrary.js";
import { provisionStarterDecks } from "../decks/deckProvisioning.js";

const TEMPLATES = [{ code: "starter", name: "Starter Deck", cards: ["ashen_knight", "brawn_idol", "cinder_skill"] }];

function makeTemp(name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `shinsu-auth-${name}-`));
  return path.join(directory, `${name}.json`);
}

async function startApp() {
  const users = makeTemp("users");
  const library = createDeckLibrary({ filePath: makeTemp("decks") });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: true }));
  app.use(
    "/auth",
    createAuthRouter({
      usersFilePath: users,
      provisionDecks: (username) => provisionStarterDecks(username, { library, decks: TEMPLATES }),
    })
  );

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}`, library, usersPath: users };
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
    expect(JSON.parse(fs.readFileSync(app.usersPath, "utf8"))).toHaveProperty("Alice");
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
    fs.writeFileSync(app.usersPath, JSON.stringify({ Legacy: {} }));

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

  test("rejects invalid usernames without creating anything", async () => {
    app = await startApp();

    const response = await login(app.baseUrl, "no");

    expect(response.status).toBe(400);
    expect(await app.library.listDecks("no")).toEqual([]);
  });
});
