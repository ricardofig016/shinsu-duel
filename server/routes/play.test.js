import express from "express";
import { createPlayRouter } from "./play.js";

// The page carries no session middleware, so the gate sees no session and
// sends the visitor to the login page, which is where a session comes from.
async function startApp() {
  const app = express();
  app.use("/play", createPlayRouter());

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

describe("play page route", () => {
  let app;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app = null;
  });

  test("redirects an anonymous visitor to the login page", async () => {
    const response = await fetch(`${app.baseUrl}/play`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?next=%2Fplay");
  });
});
