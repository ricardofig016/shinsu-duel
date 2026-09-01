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

  test("routes InitialState and user inputs to the replay stream, other entries to the events stream", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM01", directory: makeTempDir("routed") });

    fileLogger.write({ type: "InitialState", sequence: 1, meta: { roomCode: "TESTROOM01" }, state: {} });
    fileLogger.write({ type: "UserAction", sequence: 2, action: { type: "pass" }, ok: true });
    fileLogger.write({ type: "UserDecision", sequence: 3, decision: { decisionId: 1 }, ok: true });
    fileLogger.write({ rootEvent: "round:start", sequence: 4, diff: {} });
    fileLogger.write({ type: "EventFailure", sequence: 5, eventName: "boom" });

    const replay = readLines(fileLogger.paths.replay).map((line) => JSON.parse(line));
    const events = readLines(fileLogger.paths.events).map((line) => JSON.parse(line));

    expect(replay.map((entry) => entry.type)).toEqual(["InitialState", "UserAction", "UserDecision"]);
    expect(events.map((entry) => entry.type ?? entry.rootEvent)).toEqual(["round:start", "EventFailure"]);
  });

  test("writes one replay and one events file per session, named after the room", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM02", directory: makeTempDir("named") });
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });
    fileLogger.write({ rootEvent: "round:start", sequence: 2, diff: {} });

    const files = fs.readdirSync(makeTempDir("named"));
    expect(files).toHaveLength(2);
    expect(files.every((file) => file.startsWith("TESTROOM02."))).toBe(true);
    expect(files.some((file) => file.endsWith(".replay.jsonl"))).toBe(true);
    expect(files.some((file) => file.endsWith(".events.jsonl"))).toBe(true);
  });

  test("creates each stream's file on its first write", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM02B", directory: makeTempDir("lazy") });

    expect(fs.readdirSync(makeTempDir("lazy"))).toEqual([]);
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });
    expect(fs.readdirSync(makeTempDir("lazy"))).toHaveLength(1);
    fileLogger.write({ rootEvent: "round:start", sequence: 2, diff: {} });
    expect(fs.readdirSync(makeTempDir("lazy"))).toHaveLength(2);
  });

  test("every written line parses as JSON", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM03", directory: makeTempDir("jsonl") });
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });
    fileLogger.write({ rootEvent: "round:start", sequence: 2, diff: {} });

    for (const file of [fileLogger.paths.replay, fileLogger.paths.events]) {
      for (const line of readLines(file)) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }
  });

  test("serializes eagerly so later mutations of live state do not alter the file", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM04", directory: makeTempDir("eager") });

    const liveSnapshot = { hp: 5, shinsu: { normalAvailable: 3 } };
    fileLogger.write({ rootEvent: "unit:damage", sequence: 1, stateAfter: liveSnapshot });

    liveSnapshot.hp = 99;
    liveSnapshot.shinsu.normalAvailable = 0;

    const [entry] = readLines(fileLogger.paths.events).map((line) => JSON.parse(line));
    expect(entry.stateAfter).toEqual({ hp: 5, shinsu: { normalAvailable: 3 } });
  });

  test("creates the log directory recursively", () => {
    const dir = makeTempDir("games/nested");
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM05", directory: dir });

    expect(fs.existsSync(dir)).toBe(true);
    fileLogger.write({ type: "InitialState", sequence: 1, state: {} });
    fileLogger.write({ rootEvent: "round:start", sequence: 2, diff: {} });
    expect(fs.readdirSync(dir)).toHaveLength(2);
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
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test("records a placeholder line for entries that cannot be serialized", () => {
    const fileLogger = new GameFileLogger({ roomCode: "TESTROOM08", directory: makeTempDir("circular") });

    const circular = { sequence: 9, self: null };
    circular.self = circular;
    expect(() => fileLogger.write(circular)).not.toThrow();

    const [entry] = readLines(fileLogger.paths.events).map((line) => JSON.parse(line));
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
