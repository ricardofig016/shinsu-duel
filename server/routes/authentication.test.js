import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAccountStore } from "../accounts/accountStore.js";
import { createAuthGate } from "./authentication.js";

// The session username comes from a test header, so one request can act as a
// user with a live account, a user whose record is gone, or nobody at all.
async function startApp({ accounts = { Alice: {}, Bob: {} } } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-auth-gate-"));
  const accountsFile = path.join(directory, "users.json");
  fs.writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
  const store = createAccountStore({ filePath: accountsFile });
  const gate = createAuthGate({ accounts: store });

  const app = express();
  app.use(session({ secret: "test", resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) req.session.username = req.headers["x-test-user"];
    next();
  });
  app.get("/api", gate.requireApiSession, (req, res) => res.send("api payload"));
  app.get("/page", gate.requirePageSession, (req, res) => res.send("page payload"));

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, directory, store, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

describe("session gate", () => {
  let app;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(app.directory, { recursive: true, force: true });
    app = null;
  });

  // Redirects stay unfollowed so the 302 and its Location are observable.
  const request = (url, { user, redirect = "follow" } = {}) =>
    fetch(`${app.baseUrl}${url}`, {
      headers: user ? { "x-test-user": user } : {},
      redirect,
    });

  test("answers 401 with a JSON message for an API request without a session", async () => {
    const response = await request("/api");

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: "Authentication required." });
  });

  test("redirects a page request without a session to the login page", async () => {
    const response = await request("/page", { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?next=%2Fpage");
  });

  test("carries the whole requested URL, query string included, in next", async () => {
    const response = await request("/page?room=ABC123", { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?next=%2Fpage%3Froom%3DABC123");
  });

  test("lets a session with a live account through both contracts", async () => {
    const api = await request("/api", { user: "Alice" });
    const page = await request("/page", { user: "Alice" });

    expect(api.status).toBe(200);
    expect(await api.text()).toBe("api payload");
    expect(page.status).toBe(200);
    expect(await page.text()).toBe("page payload");
  });

  test("rejects a session whose username has no account", async () => {
    const api = await request("/api", { user: "Mallory" });
    const page = await request("/page", { user: "Mallory", redirect: "manual" });

    expect(api.status).toBe(401);
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/login?next=%2Fpage");
  });

  test("rejects a session whose account is removed after the session existed", async () => {
    expect((await request("/api", { user: "Bob" })).status).toBe(200);

    await app.store.removeAccount("Bob");

    const api = await request("/api", { user: "Bob" });
    const page = await request("/page", { user: "Bob", redirect: "manual" });
    expect(api.status).toBe(401);
    expect(page.status).toBe(302);
  });

  test("keeps rejecting anonymous requests and records no account for them", async () => {
    const first = await request("/api");
    const second = await request("/api");
    const accountsFile = path.join(app.directory, "users.json");

    expect(first.status).toBe(401);
    expect(second.status).toBe(401);
    expect(await second.json()).toEqual({ message: "Authentication required." });
    expect(JSON.parse(fs.readFileSync(accountsFile, "utf8"))).toEqual({ Alice: {}, Bob: {} });
  });
});
