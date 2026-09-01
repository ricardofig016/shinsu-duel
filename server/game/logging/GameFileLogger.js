/**
 * Live on-disk logging for development stress-test rooms.
 *
 * A room whose code matches `DEV_ROOM_CODE_PATTERN` ("TESTROOM" followed by
 * digits) logs every Logger entry to two JSONL files under the configured
 * log directory, one line per entry:
 *
 *  - `<roomCode>.<startedAt>.replay.jsonl` — `InitialState` plus every
 *    `UserAction` / `UserDecision` entry (failed inputs included). This is
 *    the exact stream `ReplayDriver` consumes: filtering nothing else out,
 *    rebuilding `{ initial, actions }` from the file reproduces the game.
 *  - `<roomCode>.<startedAt>.events.jsonl` — every other entry: untyped
 *    root-event entries (with before/after snapshots, diff, and causation
 *    tree) and `EventFailure` entries.
 *
 * Entries are serialized eagerly at write time because root-event snapshots
 * alias live game state, and appends are synchronous so a hard crash loses at
 * most the line being written. Each stream's file is created on its first
 * write. `write` never throws — a logging failure must never break gameplay.
 * See docs/LOGGER_ARCHITECTURE.md for the full contract.
 */

import fs from "fs";
import path from "path";

/** The only switch for live game logging: the room code itself. */
export const DEV_ROOM_CODE_PATTERN = /^TESTROOM\d+$/;

const REPLAY_ENTRY_TYPES = new Set(["InitialState", "UserAction", "UserDecision"]);

export class GameFileLogger {
  /**
   * @param {object} args
   * @param {string} args.roomCode room code used as the file-name prefix
   * @param {string} args.directory log directory, created recursively
   *   (throws loudly: a dev room that cannot log must fail at creation)
   */
  constructor({ roomCode, directory }) {
    if (typeof roomCode !== "string" || roomCode.trim() === "") {
      throw new TypeError("GameFileLogger needs a roomCode string.");
    }
    if (typeof directory !== "string" || directory.trim() === "") {
      throw new TypeError("GameFileLogger needs a directory string.");
    }

    fs.mkdirSync(directory, { recursive: true });

    // Windows-safe timestamp (no colons), e.g. "20260214-153045".
    const startedAt = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .replace(/\.\d+Z$/, "");

    this._paths = {
      replay: path.join(directory, `${roomCode}.${startedAt}.replay.jsonl`),
      events: path.join(directory, `${roomCode}.${startedAt}.events.jsonl`),
    };
  }

  /** The two output file paths, for diagnostics and tests. */
  get paths() {
    return { replay: this._paths.replay, events: this._paths.events };
  }

  write(entry) {
    const target = REPLAY_ENTRY_TYPES.has(entry?.type) ? "replay" : "events";

    let line;
    try {
      line = JSON.stringify(entry);
      if (typeof line !== "string") throw new Error("entry serialized to nothing");
    } catch {
      line = JSON.stringify({
        sequence: entry?.sequence ?? null,
        serializationError: "entry was not JSON-serializable",
      });
    }

    try {
      fs.appendFileSync(this._paths[target], `${line}\n`);
    } catch (error) {
      console.error(`GameFileLogger: failed to append to ${this._paths[target]}:`, error);
    }
  }

  /** In-memory retrieval stays the MemoryBackend's job. */
  getAll() {
    return [];
  }

  /** Disk files are append-only artifacts; nothing to clear. */
  clear() {}
}

/**
 * Return the backends to attach for a room: a `GameFileLogger` for dev-room
 * codes, nothing for every other room.
 *
 * @param {string} roomCode
 * @param {object} args
 * @param {string} args.directory log directory for the dev-room files
 * @returns {Array<GameFileLogger>}
 */
export function devRoomLoggingBackends(roomCode, { directory }) {
  if (typeof roomCode !== "string" || !DEV_ROOM_CODE_PATTERN.test(roomCode)) {
    return [];
  }
  return [new GameFileLogger({ roomCode, directory })];
}
