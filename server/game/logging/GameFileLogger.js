/**
 * Live on-disk replay capture for development stress-test rooms.
 *
 * A room whose code matches `DEV_ROOM_CODE_PATTERN` ("TESTROOM" followed by
 * digits) records one JSONL file under the configured log directory:
 *
 *   `<roomCode>.<startedAt>.replay.jsonl` — one line per replay entry:
 *   the `InitialState` entry plus every `UserAction` / `UserDecision`
 *   entry (failed inputs included). Reading the file back and rebuilding
 *   `{ initial, actions }` reproduces the game exactly via `ReplayDriver`.
 *
 * Root-event and `EventFailure` entries are deliberately NOT persisted: the
 * engine is deterministic, so replaying the artifact regenerates the
 * complete events view (snapshots, diffs, causation trees, failures) in the
 * reconstructed game's own logger — `replayed.logger.getLogs()`. Storing
 * them on disk would duplicate information the replay stream already
 * determines. The in-memory logger is unaffected by any of this.
 *
 * Entries are serialized eagerly at write time because snapshots alias live
 * game state, and appends are synchronous so a hard crash loses at most the
 * line being written. The file is created on its first replay write.
 * `write` never throws — a logging failure must never break gameplay.
 * See docs/LOGGER_ARCHITECTURE.md for the full contract.
 */

import fs from "fs";
import path from "path";
import { REPLAY_ENTRY_TYPES } from "../Logger.js";

/** The only switch for live game logging: the room code itself. */
export const DEV_ROOM_CODE_PATTERN = /^TESTROOM\d+$/;

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

    this._path = path.join(directory, `${roomCode}.${startedAt}.replay.jsonl`);
  }

  /** The artifact's file path, for diagnostics and tests. */
  get path() {
    return this._path;
  }

  write(entry) {
    // Only the authoritative replay stream is persisted; the events view is
    // derivable by replaying, so non-replay entries are a no-op here.
    if (!REPLAY_ENTRY_TYPES.includes(entry?.type)) return;

    let line;
    try {
      line = JSON.stringify(entry);
      if (typeof line !== "string") throw new Error("entry serialized to nothing");
    } catch (error) {
      // Loud: a silently dropped replay entry would corrupt a rebuilt
      // artifact, so the placeholder line is never written silently.
      console.error(
        `GameFileLogger: entry ${entry?.sequence} was not JSON-serializable; writing a placeholder line.`,
        error
      );
      line = JSON.stringify({
        sequence: entry?.sequence ?? null,
        serializationError: "entry was not JSON-serializable",
      });
    }

    try {
      fs.appendFileSync(this._path, `${line}\n`);
    } catch (error) {
      console.error(`GameFileLogger: failed to append to ${this._path}:`, error);
    }
  }

  /** In-memory retrieval stays the MemoryBackend's job. */
  getAll() {
    return [];
  }

  /** Disk files are append-only artifacts; nothing to clear. */
  clear() {
    /* no-op */
  }
}

/**
 * Production attach point: the log backends for one game session. Returns a
 * `GameFileLogger` only for dev-room codes; every other room code logs to
 * memory alone and never touches the disk.
 *
 * @param {string} roomCode
 * @param {object} args
 * @param {string} args.directory log directory for the dev-room files
 *   (its default lives in createGameServer, the production boot point)
 * @returns {Array<GameFileLogger>}
 */
export function devRoomLoggingBackends(roomCode, { directory }) {
  if (typeof roomCode !== "string" || !DEV_ROOM_CODE_PATTERN.test(roomCode)) return [];
  return [new GameFileLogger({ roomCode, directory })];
}
