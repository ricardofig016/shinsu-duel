import fs from "fs";
import os from "os";
import path from "path";
import { jest } from "@jest/globals";
import { DEV_ROOM_CODE_PATTERN, GameFileLogger, devRoomLoggingBackends } from "../../logging/GameFileLogger.js";

describe("GameFileLogger", () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-gamelog-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const makeTempDir = (name) => path.join(tmpRoot, name);

  const readLines = (filePath) =>
    fs
      .readFileSync(filePath, "utf8")
      .split("\n")
      .filter((line) => line !== "");

  test("persists replay entries and skips every other entry", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM01", directory: makeTempDir("routed") });

    fileLogger.write({ type: "InitialState", sequence: 1, meta: { roomCode: "TESTROOM01" }, state: {} });
    fileLogger.write({ type: "UserAction", sequence: 2, action: { type: "pass" }, ok: true });
    fileLogger.write({ type: "UserDecision", sequence: 3, decision: { decisionId: 1 }, ok: true });
    fileLogger.write({ rootEvent: "round:start", sequence: 4, diff: {} });
    fileLogger.write({ type: "EventFailure", sequence: 5, eventName: "boom" });

    const replay = readLines(fileLogger.path).map((line) => JSON.parse(line));
    expect(replay.map((entry) => entry.type)).toEqual(["InitialState", "UserAction", "UserDecision"]);
    expect(fs.readdirSync(makeTempDir("routed"))).toHaveLength(1);
  });

  test("names the single artifact after the room", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM02", directory: makeTempDir("named") });
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });

    const files = fs.readdirSync(makeTempDir("named"));
    expect(files).toHaveLength(1);
    expect(files[0]).toBe(path.basename(fileLogger.path));
    expect(files[0].startsWith("TESTROOM02.")).toBe(true);
    expect(files[0].endsWith(".replay.jsonl")).toBe(true);
  });

  test("creates the file on its first replay write only", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM02B", directory: makeTempDir("lazy") });

    expect(fs.readdirSync(makeTempDir("lazy"))).toEqual([]);
    fileLogger.write({ rootEvent: "round:start", sequence: 1 });
    expect(fs.readdirSync(makeTempDir("lazy"))).toEqual([]);
    fileLogger.write({ type: "InitialState", sequence: 2, state: {} });
    expect(fs.readdirSync(makeTempDir("lazy"))).toHaveLength(1);
  });

  test("every written line parses as JSON", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM03", directory: makeTempDir("jsonl") });
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });
    fileLogger.write({ type: "UserAction", sequence: 2, action: { type: "pass" }, ok: true });

    for (const line of readLines(fileLogger.path)) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("serializes eagerly so later mutations of live state do not alter the file", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM04", directory: makeTempDir("eager") });

    // Root-event snapshots alias live game state; the file must capture the
    // entry as it looked at write time.
    const liveState = { hp: 5, shinsu: { normalAvailable: 3 } };
    fileLogger.write({ type: "UserAction", sequence: 1, action: { type: "pass" }, stateAfter: liveState, ok: true });

    liveState.hp = 99;
    liveState.shinsu.normalAvailable = 0;

    const [entry] = readLines(fileLogger.path).map((line) => JSON.parse(line));
    expect(entry.stateAfter).toEqual({ hp: 5, shinsu: { normalAvailable: 3 } });
  });

  test("creates the log directory recursively", () => {
    const dir = makeTempDir("games/nested");
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM05", directory: dir });

    expect(fs.existsSync(dir)).toBe(true);
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });
    expect(fs.readdirSync(dir)).toHaveLength(1);
  });

  test("throws when the directory cannot be created", () => {
    const filePath = makeTempDir("occupied");
    fs.writeFileSync(filePath, "not a directory");

    expect(() => new GameFileLogger({ roomCode: "TESTROOM06", directory: filePath })).toThrow();
  });

  test("write never throws, even after the log directory disappears mid-session", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const dir = makeTempDir("vanishing");
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM07", directory: dir });
    fs.rmSync(dir, { recursive: true, force: true });

    expect(() => fileLogger.write({ rootEvent: "round:start", sequence: 1 })).not.toThrow();
    expect(consoleError).not.toHaveBeenCalled(); // skipped entries never touch the disk
    expect(() => fileLogger.write({ type: "UserAction", sequence: 2, action: {}, ok: true })).not.toThrow();
    expect(consoleError).toHaveBeenCalled(); // the append failure is reported
    consoleError.mockRestore();
  });

  test("records a placeholder line for entries that cannot be serialized", () => {
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM08", directory: makeTempDir("circular") });

    const circular = { sequence: 9, type: "UserAction", self: null };
    circular.self = circular;
    expect(() => fileLogger.write(circular)).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();

    const [entry] = readLines(fileLogger.path).map((line) => JSON.parse(line));
    expect(entry.sequence).toBe(9);
    expect(entry.serializationError).toBeDefined();
  });

  test("satisfies the logger backend contract", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM09", directory: makeTempDir("contract") });
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });

    expect(fileLogger.getAll()).toEqual([]);
    expect(() => fileLogger.clear()).not.toThrow();
  });
});

describe("devRoomLoggingBackends", () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-gamelog-factory-"));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("returns a GameFileLogger for dev-room codes", () => {
    for (const code of ["TESTROOM01", "TESTROOM1", "TESTROOM99"]) {
      const backends = devRoomLoggingBackends(code, { directory: tmpRoot });
      expect(backends).toHaveLength(1);
      expect(backends[0]).toBeInstanceOf(GameFileLogger);
    }
  });

  test("returns nothing for every other room code", () => {
    for (const code of ["testroom01", "TESTROOM", "ABC123", "TESTROOMAbc", "TESTROOM01X", undefined]) {
      expect(devRoomLoggingBackends(code, { directory: tmpRoot })).toEqual([]);
    }
    expect(DEV_ROOM_CODE_PATTERN.test("TESTROOM01")).toBe(true);
  });
});
