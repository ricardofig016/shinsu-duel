import { jest } from "@jest/globals";
import { loadSession, resolveDestination, submitLogin } from "../../pages/login/login-form.js";

const response = ({ ok = true, status = 200, body = "", json = null } = {}) => ({
  ok,
  status,
  text: async () => body,
  json: async () => json,
});

describe("resolveDestination", () => {
  test("sends an authenticated visitor to the page that asked for a login", () => {
    expect(resolveDestination({ status: { isAuthenticated: true, username: "Alice" }, search: "?next=%2Fdecks" })).toBe(
      "/decks"
    );
    expect(resolveDestination({ status: { isAuthenticated: true }, search: "" })).toBe("/play");
  });

  test("keeps everyone else on the login page", () => {
    expect(resolveDestination({ status: { isAuthenticated: false }, search: "?next=%2Fdecks" })).toBeNull();
    expect(resolveDestination({ status: null, search: "?next=%2Fdecks" })).toBeNull();
  });

  test("an unsafe next never leaves the origin", () => {
    const status = { isAuthenticated: true };

    expect(resolveDestination({ status, search: "?next=https%3A%2F%2Fevil.test" })).toBe("/play");
    expect(resolveDestination({ status, search: "?next=%2Flogin" })).toBe("/play");
  });
});

describe("loadSession", () => {
  test("returns the status payload", async () => {
    const fetchImpl = jest.fn(async () => response({ json: { isAuthenticated: true, username: "Alice" } }));

    expect(await loadSession({ fetchImpl })).toEqual({ isAuthenticated: true, username: "Alice" });
  });

  test("treats a failed or unreachable status request as signed out", async () => {
    const failing = jest.fn(async () => response({ ok: false, status: 500 }));
    const offline = jest.fn(async () => {
      throw new Error("offline");
    });

    expect(await loadSession({ fetchImpl: failing })).toBeNull();
    expect(await loadSession({ fetchImpl: offline })).toBeNull();
  });
});

describe("submitLogin", () => {
  test("posts the username and navigates to the destination", async () => {
    const fetchImpl = jest.fn(async () => response({ ok: true }));
    const navigate = jest.fn();

    const message = await submitLogin({ username: "Alice", nextPath: "/decks", fetchImpl, navigate });

    expect(message).toBeNull();
    expect(fetchImpl).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Alice" }),
    });
    expect(navigate).toHaveBeenCalledWith("/decks");
  });

  test("returns the server's message and stays put when the login is rejected", async () => {
    const fetchImpl = jest.fn(async () => response({ ok: false, status: 400, body: "Username is required" }));
    const navigate = jest.fn();

    const message = await submitLogin({ username: "", nextPath: "/play", fetchImpl, navigate });

    expect(message).toBe("Username is required");
    expect(navigate).not.toHaveBeenCalled();
  });

  test("falls back to a generic message when the rejection carries no text", async () => {
    const fetchImpl = jest.fn(async () => response({ ok: false, status: 400, body: "   " }));

    expect(await submitLogin({ username: "x", nextPath: "/play", fetchImpl })).toBe("Login failed. Please try again.");
  });
});
