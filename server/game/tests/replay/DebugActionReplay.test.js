import fs from "fs";
import os from "os";
import path from "path";
import ReplayDriver from "../../replay/ReplayDriver.js";
import { createSeededGame } from "../../gameFactory.js";
import { devRoomLoggingBackends } from "../../logging/GameFileLogger.js";
import { EVENTS } from "../../net/protocol.js";
import { createNetHarness } from "../net/harness.js";
import {
  cards,
  createTestGame,
  debugAction,
  getCardIdByName,
  setupGameWithHands,
  advanceToRound,
} from "../utils.js";

/**
 * Debug mutations are engine actions, so they belong to the replay stream the
 * same way player actions do, and an artifact containing them must reconstruct
 * byte-for-byte. Queries and firehose lines are diagnostics: they never appear
 * in the stream at all.
 */

const DEV_ROOM = "TESTROOM77";
const ROOM_RECORD = (seed) => ({ players: [], opponent: "friend", difficulty: null, seed });

describe("debug action replay", () => {
  let tmpRoot;
  let harness;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-debugreplay-"));
  });

  afterEach(async () => {
    if (harness) await harness.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("a scripted dev-console session replays byte-for-byte", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Novick"] });
    advanceToRound(game, 3);
    const run = (type, data) => game.processAction(debugAction(type, data));

    run("debug-draw-action", { username: "Alice", amount: 2 });
    run("debug-add-to-hand-action", { username: "Bob", cardId: getCardIdByName("Test Big Hitter") });
    run("debug-add-to-deck-action", { username: "Alice", cardId: getCardIdByName("Test Trait Unit"), placement: "bottom" });
    run("debug-shuffle-deck-action", { username: "Alice" });
    run("debug-mulligan-action", { username: "Bob", amount: 5 });
    run("debug-grant-shinsu-action", { username: "Alice", amount: 2 });
    run("debug-spawn-unit-action", { username: "Alice", cardId: getCardIdByName("Test Scout"), positionCode: "scout" });
    run("debug-force-turn-action", {});
    run("debug-set-round-action", { round: 5 });
    run("debug-end-round-action", {});
    run("debug-lighthouses-action", { username: "Bob", amount: -4 });
    run("debug-spawn-unit-action", { username: "Bob", cardId: getCardIdByName("Test Big Hitter"), positionCode: "fisherman" });

    const target = game.playerStates.Bob.field.frontline[0];
    run("debug-unit-hp-action", { unitId: target.id, value: 7 });
    run("debug-destroy-unit-action", { unitId: target.id });
    run("debug-mulligan-action", { username: "Alice", amount: 3 });

    const finalState = game.toSerializedState();
    const replayLog = game.logger.getReplayLog();
    const debugEntries = replayLog.actions.filter((entry) => entry.action?.type.startsWith("debug-"));
    expect(debugEntries).toHaveLength(15);
    expect(debugEntries.every((entry) => entry.action.data.source === "debug")).toBe(true);
    // The pass actions that advanced the round are in the same stream.
    expect(replayLog.actions.filter((entry) => entry.action?.type === "pass-turn-action").length).toBeGreaterThan(0);

    const replayed = ReplayDriver.replay(replayLog, { cards });
    expect(JSON.stringify(replayed.toSerializedState())).toBe(JSON.stringify(finalState));
  });

  test("a TESTROOM artifact with debug actions reconstructs from disk", async () => {
    harness = await createNetHarness({
      createGame: ({ roomCode, usernames, seed, decks, enforceDeckRules }) =>
        createSeededGame({
          roomCode,
          usernames,
          seed,
          decks,
          enforceDeckRules,
          cards,
          loggerBackends: devRoomLoggingBackends(roomCode, { directory: tmpRoot }),
        }),
    });
    harness.rooms[DEV_ROOM] = ROOM_RECORD(42);
    harness.joinRoom(DEV_ROOM, "Alice");
    harness.joinRoom(DEV_ROOM, "Bob");
    const seats = {
      Alice: await harness.connectPlayer({ username: "Alice", roomCode: DEV_ROOM }),
      Bob: await harness.connectPlayer({ username: "Bob", roomCode: DEV_ROOM }),
    };
    await harness.pickDecks({ alice: seats.Alice, bob: seats.Bob });
    await harness.waitFor(
      () => seats.Alice.lastPayloadOf(EVENTS.GAME_INIT) !== null,
      "game-init never arrived."
    );

    const session = harness.registry.get(DEV_ROOM);
    const commands = [
      { type: "debug-draw-action", data: { username: "Alice", amount: 2 } },
      { type: "debug-grant-shinsu-action", data: { username: "Bob", amount: 3 } },
      { type: "debug-spawn-unit-action", data: { username: "Alice", cardId: getCardIdByName("Test Scout"), positionCode: "scout" } },
      { type: "debug-force-turn-action", data: {} },
      { type: "debug-mulligan-action", data: { username: "Bob", amount: 5 } },
    ];

    const updatesBefore = seats.Alice.payloadsOf(EVENTS.GAME_UPDATE).length;
    for (const [index, command] of commands.entries()) {
      seats.Alice.emit(EVENTS.GAME_DEBUG_ACTION, command);
      await harness.waitFor(
        () => seats.Alice.payloadsOf(EVENTS.GAME_UPDATE).length > updatesBefore + index,
        `debug command ${index} never produced a state update.`
      );
    }

    // A query and a firehose toggle in the middle of the mutation stream.
    seats.Alice.emit(EVENTS.GAME_DEBUG_QUERY, { kind: "state", requestId: "q1" });
    await seats.Alice.next(EVENTS.GAME_DEBUG_RESULT);
    seats.Alice.emit(EVENTS.GAME_DEBUG_FIREHOSE, { enabled: false });

    const finalState = session.game.toSerializedState();
    await harness.close();
    harness = null;

    const files = fs.readdirSync(tmpRoot);
    expect(files).toHaveLength(1);
    expect(files[0].startsWith(`${DEV_ROOM}.`)).toBe(true);

    const entries = fs
      .readFileSync(path.join(tmpRoot, files[0]), "utf8")
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line));

    const initial = entries.find((entry) => entry.type === "InitialState");
    const actions = entries.filter((entry) => entry.type !== "InitialState");
    expect(actions).toHaveLength(commands.length);
    expect(actions.map((entry) => entry.action.type)).toEqual(commands.map((command) => command.type));
    expect(actions.every((entry) => entry.action.data.source === "debug")).toBe(true);
    expect(actions.every((entry) => entry.ok === true)).toBe(true);

    const replayed = ReplayDriver.replay({ initial, actions }, { cards });
    expect(JSON.stringify(replayed.toSerializedState())).toBe(JSON.stringify(finalState));
  });

  test("a plain engine session records debug actions even outside the socket layer", () => {
    const game = createTestGame();
    game.processAction(debugAction("debug-lighthouses-action", { username: "Alice", amount: 1 }));

    const replayed = ReplayDriver.replay(game.logger.getReplayLog(), { cards });

    expect(replayed.playerStates.Alice.lighthouses.amount).toBe(game.playerStates.Alice.lighthouses.amount);
    expect(JSON.stringify(replayed.toSerializedState())).toBe(JSON.stringify(game.toSerializedState()));
  });
});
