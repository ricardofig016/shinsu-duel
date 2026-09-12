import express from "express";
import login from "./login.js";

// No session middleware and no gate: this route is the one page an anonymous
// visitor is sent to, so it must answer on its own.
async function startApp() {
  const app = express();
  app.use("/login", login);

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { server, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

describe("login page route", () => {
  let app;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    app = null;
  });

  test("serves the login page to a request with no session", async () => {
    const response = await fetch(`${app.baseUrl}/login`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/text\/html/);
    const page = await response.text();
    expect(page).toContain('id="login-form"');
    expect(page).toContain('id="login-username"');
    expect(page).toContain("/pages/login/script.js");
  });
});
