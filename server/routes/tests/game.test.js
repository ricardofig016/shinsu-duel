import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGameRouter } from "../game.js";
import { createAccountStore } from "../../accounts/accountStore.js";

// The session username comes from a test header, so each request can act as
// any user without juggling cookies. Accounts live in a temporary file, so the
// gate never reads the runtime accounts of the machine running the tests.
const TEST_ACCOUNTS = { Alice: {}, Bob: {}, Mallory: {} };

function startApp({ rooms = {}, sessions = {} } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-game-route-"));
  const roomsPath = path.join(directory, "rooms.json");
  const accountsPath = path.join(directory, "users.json");
  fs.writeFileSync(accountsPath, JSON.stringify(TEST_ACCOUNTS, null, 2));
  fs.writeFileSync(roomsPath, JSON.stringify(rooms, null, 2));
  const accounts = createAccountStore({ filePath: accountsPath });
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) req.session.username = req.headers["x-test-user"];
    next();
  });
  const registry = { get: (roomCode) => sessions[roomCode] ?? null };
  app.use("/game", createGameRouter({ roomsFilePath: roomsPath, accounts, registry }));

  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once("listening", () =>
      resolve({ server, roomsPath, baseUrl: `http://127.0.0.1:${server.address().port}` })
    );
  });
}

describe("game room routes", () => {
  let app;

  beforeEach(async () => {
    app = await startApp();
  });

  afterEach(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(path.dirname(app.roomsPath), { recursive: true, force: true });
  });

  const post = (path, user, body) =>
    fetch(`${app.baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });

  test("createRoom registers a room and join tracks both seats", async () => {
    const created = await post("/game/createRoom", "Alice", { opponent: "friend" });
    const roomCode = await created.text();

    expect(created.status).toBe(200);
    expect((await post(`/game/${roomCode}/join`, "Alice")).status).toBe(200);
    expect((await post(`/game/${roomCode}/join`, "Bob")).status).toBe(200);

    const rooms = JSON.parse(fs.readFileSync(app.roomsPath, "utf8"));
    expect(rooms[roomCode].players).toEqual(["Alice", "Bob"]);
  });

  test("concurrent joins never lose a seat", async () => {
    const created = await post("/game/createRoom", "Alice", { opponent: "friend" });
    const roomCode = await created.text();

    // Both joins race: before the file lock existed, the second write
    // clobbered the first and one seat was locked out of its own room.
    const [, , rooms] = await Promise.all([
      post(`/game/${roomCode}/join`, "Alice"),
      post(`/game/${roomCode}/join`, "Bob"),
      new Promise((resolve) => setTimeout(() => resolve(JSON.parse(fs.readFileSync(app.roomsPath, "utf8"))), 300)),
    ]);
    expect([...rooms[roomCode].players].sort()).toEqual(["Alice", "Bob"]);
  });

  test("a room is full at two players", async () => {
    const created = await post("/game/createRoom", "Alice", { opponent: "friend" });
    const roomCode = await created.text();
    await post(`/game/${roomCode}/join`, "Alice");
    await post(`/game/${roomCode}/join`, "Bob");

    const third = await post(`/game/${roomCode}/join`, "Mallory");
    expect(third.status).toBe(403);
  });

  test("createRoom records a bot room with its bot spec", async () => {
    const created = await post("/game/createRoom", "Alice", { opponent: "bot", bot: "whatever", deckMethod: "mirror" });
    const roomCode = await created.text();

    expect(created.status).toBe(200);
    const rooms = JSON.parse(fs.readFileSync(app.roomsPath, "utf8"));
    expect(rooms[roomCode]).toMatchObject({
      players: [],
      opponent: "bot",
      bot: { bot: "whatever", deckMethod: "mirror" },
    });
    expect(typeof rooms[roomCode].seed).toBe("number");
    expect(rooms[roomCode].difficulty).toBeUndefined();
  });

  test("createRoom refuses a bot room with an unknown bot, deck method, or missing spec", async () => {
    for (const body of [
      { opponent: "bot", bot: "easy", deckMethod: "mirror" },
      { opponent: "bot", bot: "whatever", deckMethod: "random" },
      { opponent: "bot", deckMethod: "mirror" },
      { opponent: "bot", bot: "whatever" },
      { opponent: "bot" },
    ]) {
      const response = await post("/game/createRoom", "Alice", body);
      expect(response.status).toBe(400);
      const rooms = JSON.parse(fs.readFileSync(app.roomsPath, "utf8"));
      expect(Object.keys(rooms)).toHaveLength(0);
    }
  });

  test("a bot room is full once its creator has joined", async () => {
    const created = await post("/game/createRoom", "Alice", { opponent: "bot", bot: "drunk", deckMethod: "generated" });
    const roomCode = await created.text();

    expect((await post(`/game/${roomCode}/join`, "Alice")).status).toBe(200);
    const second = await post(`/game/${roomCode}/join`, "Bob");
    expect(second.status).toBe(403);

    const rooms = JSON.parse(fs.readFileSync(app.roomsPath, "utf8"));
    expect(rooms[roomCode].players).toEqual(["Alice"]);
  });

  test("refuses room creation and joining without a session", async () => {
    const created = await post("/game/createRoom", null, { opponent: "friend" });
    const joined = await post("/game/ABCDEF/join", null);

    expect(created.status).toBe(401);
    expect(await created.json()).toEqual({ message: "Authentication required." });
    expect(joined.status).toBe(401);
  });

  test("redirects an anonymous visitor away from the game page", async () => {
    const response = await fetch(`${app.baseUrl}/game/ABCDEF`, { redirect: "manual" });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/login?next=%2Fgame%2FABCDEF");
  });

  test("refuses a request from a session whose account is gone", async () => {
    const response = await fetch(`${app.baseUrl}/game/createRoom`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-test-user": "Nobody" },
      body: JSON.stringify({ opponent: "friend" }),
    });

    expect(response.status).toBe(401);
  });
});

// Markers unique to each step document, so a test can tell which page a room
// address actually served.
const WAITING_PAGE = "waiting-room-code";
const DECK_PAGE = "deck-table-body";
const BOARD_PAGE = "round-indicator";
const DENIED_PAGE = "This room is not available";

const ROOM_RECORD = (players, opponent = "friend") => ({ players, opponent, seed: 1 });

const BOT_ROOM_RECORD = (players) => ROOM_RECORD(players, "bot");

describe("room step routing", () => {
  let app;

  const start = async (options) => {
    app = await startApp(options);
  };

  afterEach(async () => {
    await new Promise((resolve) => app.server.close(resolve));
    fs.rmSync(path.dirname(app.roomsPath), { recursive: true, force: true });
  });

  const get = (path, user = "Alice") =>
    fetch(`${app.baseUrl}${path}`, { redirect: "manual", headers: { "x-test-user": user } });

  test("a room with no session sends every address to the waiting room", async () => {
    await start({ rooms: { AB12CD: ROOM_RECORD(["Alice", "Bob"]) } });

    for (const address of ["/game/AB12CD", "/game/AB12CD/deck"]) {
      const response = await get(address);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/game/AB12CD/waiting");
    }

    const waiting = await get("/game/AB12CD/waiting");
    expect(waiting.status).toBe(200);
    expect(await waiting.text()).toContain(WAITING_PAGE);
  });

  test("an unstarted session sends every address to the deck step", async () => {
    await start({
      rooms: { AB12CD: ROOM_RECORD(["Alice", "Bob"]) },
      sessions: { AB12CD: { isStarted: false } },
    });

    for (const address of ["/game/AB12CD", "/game/AB12CD/waiting"]) {
      const response = await get(address);
      expect(response.status).toBe(302);
      expect(response.headers.get("location")).toBe("/game/AB12CD/deck");
    }

    const deck = await get("/game/AB12CD/deck");
    expect(deck.status).toBe(200);
    expect(await deck.text()).toContain(DECK_PAGE);
  });

  test("a started session sends every address to the board", async () => {
    await start({
      rooms: { AB12CD: ROOM_RECORD(["Alice", "Bob"]) },
      sessions: { AB12CD: { isStarted: true } },
    });

    const deck = await get("/game/AB12CD/deck");
    expect(deck.status).toBe(302);
    expect(deck.headers.get("location")).toBe("/game/AB12CD");

    const board = await get("/game/AB12CD");
    expect(board.status).toBe(200);
    expect(await board.text()).toContain(BOARD_PAGE);
  });

  test("a visitor with a free seat reaches the waiting room without taking the seat", async () => {
    await start({ rooms: { AB12CD: ROOM_RECORD(["Alice"]) } });

    const response = await get("/game/AB12CD/deck", "Bob");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/game/AB12CD/waiting");
    const waiting = await get("/game/AB12CD/waiting", "Bob");
    expect(waiting.status).toBe(200);
    expect(await waiting.text()).toContain(WAITING_PAGE);

    // Reading a room address never seats anyone: the waiting room page claims
    // the seat through the join route, so a link preview cannot fill the room.
    const rooms = JSON.parse(fs.readFileSync(app.roomsPath, "utf8"));
    expect(rooms.AB12CD.players).toEqual(["Alice"]);
  });

  test("a visitor with no seat left gets the denied page", async () => {
    await start({ rooms: { AB12CD: ROOM_RECORD(["Alice", "Bob"]) } });

    const response = await get("/game/AB12CD", "Mallory");

    expect(response.status).toBe(403);
    expect(await response.text()).toContain(DENIED_PAGE);
  });

  test("a bot room that has seated its creator denies every other visitor", async () => {
    await start({ rooms: { AB12CD: BOT_ROOM_RECORD(["Alice"]) } });

    for (const user of ["Bob", "Mallory"]) {
      const response = await get("/game/AB12CD/waiting", user);
      expect(response.status).toBe(403);
      expect(await response.text()).toContain(DENIED_PAGE);
    }

    // The creator still reaches the room's own step.
    const own = await get("/game/AB12CD/waiting", "Alice");
    expect(own.status).toBe(200);
    expect(await own.text()).toContain(WAITING_PAGE);
  });

  test("an unknown room code gets the denied page", async () => {
    await start({});

    const response = await get("/game/NOPE99");

    expect(response.status).toBe(404);
    expect(await response.text()).toContain(DENIED_PAGE);
  });
});
