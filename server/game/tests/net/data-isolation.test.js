import fs from "fs";
import os from "os";
import path from "path";
import { expectRuntimeDataUnchanged, runtimeDataChanges, snapshotRuntimeData } from "./data-isolation.js";

/**
 * The guard itself: a snapshot must catch a write to a shipped data file,
 * ignore an untouched directory, and report created and removed files.
 */
describe("runtime data guard", () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-data-guard-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const write = (name, contents) => fs.writeFileSync(path.join(directory, name), JSON.stringify(contents));

  test("passes when nothing under the directory changed", () => {
    write("users.json", { Alice: {} });

    expectRuntimeDataUnchanged(snapshotRuntimeData(directory), directory);
  });

  test("catches a modified file", () => {
    write("decks.json", { A: {} });
    const before = snapshotRuntimeData(directory);

    write("decks.json", { A: {}, B: {} });

    expect(runtimeDataChanges(before, directory)).toEqual(["decks.json was modified"]);
    expect(() => expectRuntimeDataUnchanged(before, directory)).toThrow(/decks\.json was modified/);
  });

  test("catches a created file, which is how a leaked login announces itself", () => {
    const before = snapshotRuntimeData(directory);

    write("users.json", { Alice: {} });

    expect(runtimeDataChanges(before, directory)).toEqual(["users.json was created"]);
    expect(() => expectRuntimeDataUnchanged(before, directory)).toThrow(/never touch server\/data/);
  });

  test("catches a removed file", () => {
    write("users.json", { Alice: {} });
    const before = snapshotRuntimeData(directory);

    fs.rmSync(path.join(directory, "users.json"));

    expect(runtimeDataChanges(before, directory)).toEqual(["users.json was removed"]);
  });

  test("reports every change at once", () => {
    write("users.json", { Alice: {} });
    write("decks.json", { A: {} });
    const before = snapshotRuntimeData(directory);

    write("users.json", { Alice: {}, Bob: {} });
    write("rooms.json", { ROOM1: {} });

    const changes = runtimeDataChanges(before, directory);
    expect(changes).toEqual(["users.json was modified", "rooms.json was created"]);
  });
});
