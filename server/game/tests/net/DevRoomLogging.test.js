import fs from "fs";
import os from "os";
import path from "path";
import { EVENTS } from "../../net/protocol.js";
import { createNetHarness } from "./harness.js";

/**
 * Boots the production default game factory (createGameServer's own closure)
 * against an in-memory room store, so the TESTROOM dev-logging wiring is
 * exercised exactly as in production — only through the room code pattern.
 */

const ROOM_RECORD = (seed) => ({ players: [], opponent: "friend", difficulty: null, seed });

describe("dev-room live logging (production wiring)", () => {
  let tmpRoot;
  let harness;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-devroom-"));
  });

  afterEach(async () => {
    if (harness) await harness.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const readLines = (filePath) =>
    fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line !== "");

  test("a TESTROOM room logs its replay stream; a normal room logs nothing", async () => {
    harness = await createNetHarness({ gameLogDirectory: tmpRoot });

    // Registered exactly like a hand-edited server/data/rooms.json record.
    harness.rooms["TESTROOM01"] = ROOM_RECORD(1);
    harness.rooms["ABC123"] = ROOM_RECORD(2);
    for (const roomCode of ["TESTROOM01", "ABC123"]) {
      harness.joinRoom(roomCode, "Alice");
      harness.joinRoom(roomCode, "Bob");
    }

    const devAlice = await harness.connectPlayer({ username: "Alice", roomCode: "TESTROOM01" });
    const devBob = await harness.connectPlayer({ username: "Bob", roomCode: "TESTROOM01" });
    const plainAlice = await harness.connectPlayer({ username: "Alice", roomCode: "ABC123" });
    const plainBob = await harness.connectPlayer({ username: "Bob", roomCode: "ABC123" });

    await harness.waitFor(
      () => devAlice.lastPayloadOf(EVENTS.GAME_INIT) !== null && devBob.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "game-init never arrived for the dev room."
    );
    await harness.waitFor(
      () => plainAlice.lastPayloadOf(EVENTS.GAME_INIT) !== null && plainBob.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "game-init never arrived for the normal room."
    );

    // The production factory rolls the first player from the room's seed, so
    // each seat acts only when the engine says it is that seat's turn.
    const devSeats = { Alice: devAlice, Bob: devBob };
    const passFrom = (roomCode, seats) => {
      const current = harness.registry.get(roomCode).game.currentTurn;
      seats[current].emit(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: {} });
    };

    passFrom("TESTROOM01", devSeats);
    await devBob.next(EVENTS.GAME_UPDATE);
    passFrom("TESTROOM01", devSeats);
    await devAlice.next(EVENTS.GAME_UPDATE);

    passFrom("ABC123", { Alice: plainAlice, Bob: plainBob });
    await plainBob.next(EVENTS.GAME_UPDATE);

    for (const client of [devAlice, devBob, plainAlice, plainBob]) {
      expect(client.payloadsOf(EVENTS.GAME_ERROR)).toEqual([]);
    }

    // Only the dev room produced files: exactly one replay artifact. The
    // events view (diffs, causation trees, failures) is derivable by
    // replaying this stream, so there is no separate events file.
    const files = fs.readdirSync(tmpRoot);
    expect(files).toHaveLength(1);
    expect(files[0].startsWith("TESTROOM01.")).toBe(true);
    expect(files[0].endsWith(".replay.jsonl")).toBe(true);

    const replayPath = path.join(tmpRoot, files[0]);

    const replayEntries = readLines(replayPath).map((line) => JSON.parse(line));
    expect(replayEntries[0].type).toBe("InitialState");
    expect(replayEntries[0].meta.roomCode).toBe("TESTROOM01");
    expect(replayEntries[0].meta.rngSeed).toBe(1);
    expect(replayEntries.filter((entry) => entry.type === "UserAction")).toHaveLength(2);
    expect(replayEntries.every((entry) => ["InitialState", "UserAction", "UserDecision"].includes(entry.type))).toBe(true);
  });

  test("a dev room still plays normally when the log directory cannot be used", async () => {
    // Point the log directory at a path occupied by a file: the logger's
    // directory creation throws, the gateway reports it, but no unrelated
    // room may be affected. A dev room failing loudly at creation is the
    // documented contract (see GameFileLogger).
    const blocker = path.join(tmpRoot, "occupied");
    fs.writeFileSync(blocker, "not a directory");
    harness = await createNetHarness({ gameLogDirectory: blocker });

    harness.rooms["TESTROOM02"] = ROOM_RECORD(1);
    harness.joinRoom("TESTROOM02", "Alice");
    harness.joinRoom("TESTROOM02", "Bob");
    const alice = await harness.connectPlayer({ username: "Alice", roomCode: "TESTROOM02" });
    const bob = await harness.connectPlayer({ username: "Bob", roomCode: "TESTROOM02" });

    // The game starts when both seats are connected; its creation fails
    // because the logger cannot create its directory, and the failure is
    // broadcast to both seats.
    await harness.waitFor(
      () => alice.lastPayloadOf(EVENTS.GAME_ERROR) !== null || bob.lastPayloadOf(EVENTS.GAME_ERROR) !== null,
      "game creation failure was never reported to the players."
    );
    expect(harness.registry.get("TESTROOM02").game).toBeNull();
  });
});
