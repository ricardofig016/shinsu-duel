import crypto from "crypto";
import fs from "fs";
import path from "path";

/**
 * Guard for the runtime data files under `server/data`.
 *
 * The net harness boots the real server, so a wiring mistake can make a suite
 * reach the files of the machine running it: accounts are written on login and
 * provisioned decks on account creation. Those files are gitignored, which
 * means such a write leaves no trace in `git status`.
 *
 * A suite snapshots the directory before it runs and compares afterwards, so
 * any shipped-file write fails the suite that caused it.
 */

const DATA_DIRECTORY = path.resolve("server/data");

const contentHash = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

/** Modification time, size, and content hash of every file in `server/data`. */
export function snapshotRuntimeData(directory = DATA_DIRECTORY) {
  const snapshot = new Map();
  if (!fs.existsSync(directory)) return snapshot;
  for (const name of fs.readdirSync(directory).sort()) {
    const filePath = path.join(directory, name);
    if (!fs.statSync(filePath).isFile()) continue;
    const stats = fs.statSync(filePath);
    snapshot.set(name, { mtimeMs: stats.mtimeMs, size: stats.size, hash: contentHash(filePath) });
  }
  return snapshot;
}

/**
 * @returns {string[]} one message per changed, created, or removed file; empty
 *   when `server/data` is exactly as the snapshot found it.
 */
export function runtimeDataChanges(before, directory = DATA_DIRECTORY) {
  const after = snapshotRuntimeData(directory);
  const changes = [];

  for (const [name, was] of before) {
    const now = after.get(name);
    if (!now) {
      changes.push(`${name} was removed`);
      continue;
    }
    if (now.hash !== was.hash) changes.push(`${name} was modified`);
  }
  for (const name of after.keys()) {
    if (!before.has(name)) changes.push(`${name} was created`);
  }
  return changes;
}

/**
 * Fail the calling test when anything under `server/data` changed since
 * `before`. Phrased as a thrown error so it reads as the wiring failure it is.
 */
export function expectRuntimeDataUnchanged(before, directory = DATA_DIRECTORY) {
  const changes = runtimeDataChanges(before, directory);
  if (changes.length > 0) {
    throw new Error(
      `A test wrote to the runtime data files (${changes.join(", ")}). ` +
        "Tests inject their own accounts and deck storage; they must never touch server/data."
    );
  }
}
