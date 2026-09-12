import { jest } from "@jest/globals";
import { authFetch, loginUrlFor, redirectToLogin, safeNextPath } from "../../utils/auth-redirect.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

const response = (status) => ({ status, ok: status >= 200 && status < 300 });

describe("loginUrlFor", () => {
  test("carries the path and query string of the current location", () => {
    expect(loginUrlFor({ pathname: "/game/ABC123", search: "" })).toBe("/login?next=%2Fgame%2FABC123");
    expect(loginUrlFor({ pathname: "/decks", search: "?page=2" })).toBe("/login?next=%2Fdecks%3Fpage%3D2");
  });

  test("falls back to the play page when there is no location", () => {
    expect(loginUrlFor(null)).toBe("/login?next=%2Fplay");
  });
});

describe("safeNextPath", () => {
  test("accepts a same-origin relative path", () => {
    expect(safeNextPath("?next=%2Fgame%2FABC123")).toBe("/game/ABC123");
    expect(safeNextPath("next=/decks")).toBe("/decks");
    expect(safeNextPath("?next=%2Fgame%2FABC123%3Fspectate%3D1")).toBe("/game/ABC123?spectate=1");
    expect(safeNextPath("?next=%2F")).toBe("/");
  });

  test("falls back for anything that could leave the origin", () => {
    const unsafe = [
      "?next=https%3A%2F%2Fevil.test%2Fsteal",
      "?next=%2F%2Fevil.test",
      "?next=%2F%5Cevil.test",
      "?next=javascript%3Aalert%281%29",
      "?next=%2Fplay%20%2Fdecks",
      "?next=",
      "",
    ];

    for (const search of unsafe) {
      expect(safeNextPath(search)).toBe("/play");
    }
  });

  test("falls back when next points back at the login page", () => {
    expect(safeNextPath("?next=%2Flogin")).toBe("/play");
    expect(safeNextPath("?next=%2Flogin%3Fnext%3D%252Fdecks")).toBe("/play");
    expect(safeNextPath("?next=%2Flogin%2Fdecks")).toBe("/play");
  });

  test("takes a caller-supplied fallback", () => {
    expect(safeNextPath("?next=https%3A%2F%2Fevil.test", "/decks")).toBe("/decks");
  });
});

describe("redirectToLogin", () => {
  test("navigates to the login page and leaves the caller waiting", async () => {
    const navigate = jest.fn();
    let settled = false;

    redirectToLogin({ location: { pathname: "/play", search: "" }, navigate }).then(() => {
      settled = true;
    });
    await flush();

    expect(navigate).toHaveBeenCalledWith("/login?next=%2Fplay");
    expect(settled).toBe(false);
  });

  // The game page calls redirectToLogin() with no arguments when the socket
  // rejects its identity, so the browser location is what carries the room the
  // player must return to.
  test("carries the current browser location when the caller passes none", () => {
    const navigate = jest.fn();
    const original = globalThis.window;
    globalThis.window = { location: { pathname: "/game/ABC123", search: "?spectate=1" } };

    try {
      redirectToLogin({ navigate });
    } finally {
      if (original === undefined) delete globalThis.window;
      else globalThis.window = original;
    }

    expect(navigate).toHaveBeenCalledWith("/login?next=%2Fgame%2FABC123%3Fspectate%3D1");
  });
});

describe("authFetch", () => {
  test("hands back every response that is not a 401", async () => {
    const navigate = jest.fn();
    const fetchImpl = jest.fn(async () => response(200));

    const result = await authFetch("/decks/data", undefined, { fetchImpl, navigate });

    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledWith("/decks/data", undefined);
    expect(navigate).not.toHaveBeenCalled();
  });

  test("sends the browser to the login page on a 401 and stops the caller", async () => {
    const navigate = jest.fn();
    const fetchImpl = jest.fn(async () => response(401));
    const init = { method: "DELETE" };
    let settled = false;

    authFetch("/decks/deck-1", init, {
      fetchImpl,
      navigate,
      location: { pathname: "/decks", search: "" },
    }).then(() => {
      settled = true;
    });
    await flush();

    expect(fetchImpl).toHaveBeenCalledWith("/decks/deck-1", init);
    expect(navigate).toHaveBeenCalledWith("/login?next=%2Fdecks");
    expect(settled).toBe(false);
  });
});
