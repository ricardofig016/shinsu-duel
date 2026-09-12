import express from "express";
import session from "express-session";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createGameRouter } from "./game.js";

// The session username comes from a test header, so each request can act as
// any user without juggling cookies.
function startApp() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-game-route-"));
  const roomsPath = path.join(directory, "rooms.json");
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: true }));
  app.use((req, res, next) => {
    if (req.headers["x-test-user"]) req.session.username = req.headers["x-test-user"];
    next();
  });
  app.use("/game", createGameRouter({ roomsFilePath: roomsPath }));

  const server = app.listen(0);
  return new Promise((resolve) => {
    server.once("listening", () => resolve({ server, roomsPath, baseUrl: `http://127.0.0.1:${server.address().port}` }));
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
      headers: { "content-type": "application/json", "x-test-user": user },
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
});
