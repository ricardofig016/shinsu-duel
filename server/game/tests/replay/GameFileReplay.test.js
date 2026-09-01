import fs from "fs";
import os from "os";
import path from "path";
import ReplayDriver from "../../replay/ReplayDriver.js";
import { applyStateDiff } from "../../utils/stateDiff.js";
import { EVENTS } from "../../net/protocol.js";
import { createNetHarness } from "../net/harness.js";

/**
 * Proves that the on-disk replay stream written by the dev-room logger is a
 * faithful artifact: read it back from disk, rebuild the replay log exactly
 * as a debugging session would, and reconstruct the game with ReplayDriver.
 *
 * The game is created by the production default factory (compiled card
 * catalog), so the replay runs without a cards override — the same way a
 * real crash artifact would be replayed.
 */

const ROOM_CODE = "TESTROOM42";

describe("GameFileLogger replay round-trip", () => {
  let tmpRoot;
  let harness;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-gamereplay-"));
  });

  afterEach(async () => {
    if (harness) await harness.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("a replay stream read back from disk reconstructs the game byte-for-byte", async () => {
    harness = await createNetHarness({ gameLogDirectory: tmpRoot });
    harness.rooms[ROOM_CODE] = { players: [], opponent: "friend", difficulty: null, seed: 42 };
    harness.joinRoom(ROOM_CODE, "Alice");
    harness.joinRoom(ROOM_CODE, "Bob");

    const seats = {
      Alice: await harness.connectPlayer({ username: "Alice", roomCode: ROOM_CODE }),
      Bob: await harness.connectPlayer({ username: "Bob", roomCode: ROOM_CODE }),
    };
    await harness.waitFor(
      () => seats.Alice.lastPayloadOf(EVENTS.GAME_INIT) !== null && seats.Bob.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "game-init never arrived."
    );

    const currentTurn = () => harness.registry.get(ROOM_CODE).game.currentTurn;

    // A failed action first: the off-turn seat passes and is rejected. The
    // logger records it with ok:false and the engine state is unchanged.
    const offTurn = currentTurn() === "Alice" ? "Bob" : "Alice";
    seats[offTurn].emit(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: {} });
    await harness.waitFor(
      () => seats[offTurn].lastPayloadOf(EVENTS.GAME_ERROR) !== null,
      "the off-turn pass was never rejected."
    );

    // Four accepted passes: two full rounds of turn handover.
    for (let i = 0; i < 4; i += 1) {
      seats[currentTurn()].emit(EVENTS.GAME_ACTION, { type: "pass-turn-action", data: {} });
      await harness.waitFor(
        () => seats.Alice.payloadsOf(EVENTS.GAME_UPDATE).length > i || seats.Bob.payloadsOf(EVENTS.GAME_UPDATE).length > i,
        `accepted pass ${i + 1} never produced a state update.`
      );
    }

    await harness.close();

    const files = fs.readdirSync(tmpRoot);
    expect(files).toHaveLength(1);
    const replayPath = path.join(tmpRoot, files[0]);

    const entries = fs
      .readFileSync(replayPath, "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));

    const initial = entries.find((entry) => entry.type === "InitialState");
    const actions = entries.filter((entry) => entry.type === "UserAction" || entry.type === "UserDecision");

    expect(initial).toBeDefined();
    expect(initial.meta.rngSeed).toBe(42);
    expect(actions).toHaveLength(5);
    expect(actions.filter((action) => action.ok === false)).toHaveLength(1);
    expect(actions.filter((action) => action.ok === true)).toHaveLength(4);
    expect(actions[0].ok).toBe(false);
    expect(actions.every((action) => action.diff && action.stateAfter === undefined)).toBe(true);
    // The failed first action changed nothing: an empty diff.
    expect(actions[0].diff).toEqual({ changed: {}, removed: [] });

    // Replay exactly the way a crash artifact is replayed: no options.
    const replayed = ReplayDriver.replay({ initial, actions });

    // Independent end-to-end check: applying the recorded diffs to the
    // initial state must land on the same final state the driver produced.
    let expected = initial.state;
    for (const action of actions) expected = applyStateDiff(expected, action.diff);
    expect(replayed.toSerializedState()).toEqual(expected);
  });
});
