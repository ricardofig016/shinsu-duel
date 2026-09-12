import { EVENTS } from "../../net/protocol.js";
import {
  DEBUG_ACTION_TYPES,
  DEBUG_QUERY_KINDS,
  buildDebugAction,
  buildDebugFirehose,
  buildDebugQuery,
  buildDebugRestart,
} from "../../../../public/game/actions.js";
import { getCardIdByName } from "../utils.js";
import { makeStartedHarness, devRoom } from "./gatewayHarness.js";

/**
 * The dev console's client copy of the protocol against the server that reads
 * it. `public/game/actions.js` builds every message the console emits and
 * nothing else compares those payloads with the gateway's expectations, so a
 * field renamed on one side alone would break the console with no other test
 * failing. Every message here is built by the client's own builder.
 */

const DEV_ROOM = "TESTROOM01";

/** The console's commands that need no deployed unit, with valid arguments. */
const seatCommands = () => {
  const scout = getCardIdByName("Test Scout");

  return [
    [DEBUG_ACTION_TYPES.DRAW, { username: "Alice", amount: 1 }],
    [DEBUG_ACTION_TYPES.ADD_TO_HAND, { username: "Bob", cardId: scout }],
    [DEBUG_ACTION_TYPES.ADD_TO_DECK, { username: "Alice", cardId: scout, placement: "top" }],
    [DEBUG_ACTION_TYPES.SHUFFLE_DECK, { username: "Alice" }],
    [DEBUG_ACTION_TYPES.MULLIGAN, { username: "Bob", amount: 3 }],
    [DEBUG_ACTION_TYPES.GRANT_SHINSU, { username: "Alice", amount: 1 }],
    [DEBUG_ACTION_TYPES.SPAWN_UNIT, { username: "Alice", cardId: scout, positionCode: "scout" }],
  ];
};

describe("dev console client/server contract", () => {
  test("every debug command the client builds is accepted by the gateway", async () => {
    const harness = await makeStartedHarness({ rooms: devRoom() });
    const session = harness.registry.get(DEV_ROOM);

    const emit = async (type, data) => {
      await harness.alice.trigger(EVENTS.GAME_DEBUG_ACTION, buildDebugAction(type, data));
      expect(harness.alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    };

    const first = seatCommands();
    for (const [type, data] of first) await emit(type, data);

    // The unit commands need an id, which only exists once a unit is deployed.
    const spawned = session.game.playerStates.Alice.field.frontline[0];
    const rest = [
      [DEBUG_ACTION_TYPES.UNIT_HP, { unitId: spawned.id, value: 1 }],
      [DEBUG_ACTION_TYPES.DESTROY_UNIT, { unitId: spawned.id }],
      [DEBUG_ACTION_TYPES.SPAWN_UNIT, { username: "Bob", cardId: getCardIdByName("Test Big Hitter"), positionCode: "fisherman" }],
      [DEBUG_ACTION_TYPES.FORCE_TURN, {}],
      [DEBUG_ACTION_TYPES.SET_ROUND, { round: 3 }],
      [DEBUG_ACTION_TYPES.END_ROUND, {}],
      [DEBUG_ACTION_TYPES.LIGHTHOUSES, { username: "Alice", amount: -1 }],
    ];
    for (const [type, data] of rest) await emit(type, data);

    const emitted = [...first, ...rest];
    // Every type the client declares was exercised, and no others exist.
    expect([...new Set(emitted.map(([type]) => type))].sort()).toEqual(Object.values(DEBUG_ACTION_TYPES).sort());
    expect(harness.alice.payloadsOf(EVENTS.GAME_ERROR)).toEqual([]);
    // Every command was a recorded engine action, after the game's own start.
    expect(session.revision).toBe(1 + emitted.length);

    const recorded = session.game.logger
      .getLogs()
      .filter((entry) => entry.type === "UserAction")
      .map((entry) => entry.action.type);
    expect(recorded).toEqual(emitted.map(([type]) => type));
  });

  test("every query the client builds is answered with its own kind and request id", async () => {
    const harness = await makeStartedHarness({ rooms: devRoom() });
    const session = harness.registry.get(DEV_ROOM);
    await harness.alice.trigger(
      EVENTS.GAME_DEBUG_ACTION,
      buildDebugAction(DEBUG_ACTION_TYPES.SPAWN_UNIT, {
        username: "Alice",
        cardId: getCardIdByName("Test Scout"),
        positionCode: "scout",
      })
    );
    const unitId = session.game.playerStates.Alice.field.frontline[0].id;

    const queries = [
      [DEBUG_QUERY_KINDS.HAND, { username: "Bob" }],
      [DEBUG_QUERY_KINDS.DECK, { username: "Alice" }],
      [DEBUG_QUERY_KINDS.UNIT_ABILITIES, { unitId }],
      [DEBUG_QUERY_KINDS.STATE, {}],
      [DEBUG_QUERY_KINDS.LOGS, {}],
    ];

    for (const [index, [kind, args]] of queries.entries()) {
      const requestId = `req-${index}`;
      await harness.alice.trigger(EVENTS.GAME_DEBUG_QUERY, buildDebugQuery(kind, requestId, args));

      expect(harness.alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
      const result = harness.alice.lastPayloadOf(EVENTS.GAME_DEBUG_RESULT);
      expect(result.requestId).toBe(requestId);
      expect(result.kind).toBe(kind);
    }

    expect(harness.alice.payloadsOf(EVENTS.GAME_ERROR)).toEqual([]);
  });

  test("the firehose toggle and the restart payloads are accepted as built", async () => {
    const harness = await makeStartedHarness({ rooms: devRoom() });
    const session = harness.registry.get(DEV_ROOM);

    await harness.alice.trigger(EVENTS.GAME_DEBUG_FIREHOSE, buildDebugFirehose(false));
    expect(harness.alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    expect(session.isFirehoseEnabled).toBe(false);

    await harness.alice.trigger(EVENTS.GAME_DEBUG_FIREHOSE, buildDebugFirehose(true));
    expect(session.isFirehoseEnabled).toBe(true);

    await harness.alice.trigger(EVENTS.GAME_DEBUG_RESTART, buildDebugRestart());
    expect(harness.alice.lastPayloadOf(EVENTS.GAME_ERROR)).toBeNull();
    expect(harness.registry.get(DEV_ROOM).isStarted).toBe(false);
  });
});
