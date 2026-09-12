import { EVENTS } from "../../game/protocol.js";
import {
  STEP,
  STEP_PATHS,
  roomPath,
  roomCodeFromPath,
  stepForEvent,
  stepFromPath,
  stepPath,
} from "../../game/steps.js";

describe("room step addresses", () => {
  test("each step has one address, and the board keeps the bare room address", () => {
    expect(stepPath("AB12CD", STEP.WAITING)).toBe("/game/AB12CD/waiting");
    expect(stepPath("AB12CD", STEP.DECK)).toBe("/game/AB12CD/deck");
    expect(stepPath("AB12CD", STEP.BOARD)).toBe("/game/AB12CD");
    expect(roomPath("AB12CD")).toBe("/game/AB12CD");
    expect(() => stepPath("AB12CD", "lobby")).toThrow(TypeError);
  });

  test("the step table covers every step", () => {
    expect(Object.keys(STEP_PATHS).sort()).toEqual(Object.values(STEP).sort());
  });
});

describe("room addresses read back", () => {
  test("the room code comes out of every room address", () => {
    expect(roomCodeFromPath("/game/AB12CD")).toBe("AB12CD");
    expect(roomCodeFromPath("/game/AB12CD/waiting")).toBe("AB12CD");
    expect(roomCodeFromPath("/game/TESTROOM01/deck")).toBe("TESTROOM01");
  });

  test("a path that is not a room address has no room code", () => {
    expect(roomCodeFromPath("/play")).toBeNull();
    expect(roomCodeFromPath("/decks")).toBeNull();
    expect(roomCodeFromPath("/game")).toBeNull();
    expect(roomCodeFromPath("/game/AB12CD/deck/extra")).toBeNull();
    expect(roomCodeFromPath("")).toBeNull();
    expect(roomCodeFromPath(null)).toBeNull();
  });

  test("the step comes out of every room address, board by default", () => {
    expect(stepFromPath("/game/AB12CD")).toBe(STEP.BOARD);
    expect(stepFromPath("/game/AB12CD/waiting")).toBe(STEP.WAITING);
    expect(stepFromPath("/game/AB12CD/deck")).toBe(STEP.DECK);
  });

  test("an address that names no room step has none", () => {
    expect(stepFromPath("/game/AB12CD/lobby")).toBeNull();
    expect(stepFromPath("/play")).toBeNull();
    expect(stepFromPath("/game/AB12CD/deck/extra")).toBeNull();
  });
});

describe("stepForEvent", () => {
  test("each step-naming message maps to its step", () => {
    expect(stepForEvent(EVENTS.GAME_WAITING)).toBe(STEP.WAITING);
    expect(stepForEvent(EVENTS.GAME_DECK_STATUS)).toBe(STEP.DECK);
    expect(stepForEvent(EVENTS.GAME_INIT)).toBe(STEP.BOARD);
  });

  test("a message that names no step maps to none", () => {
    expect(stepForEvent(EVENTS.GAME_UPDATE)).toBeNull();
    expect(stepForEvent(EVENTS.GAME_OVER)).toBeNull();
    expect(stepForEvent(EVENTS.GAME_DECK_REVEAL)).toBeNull();
    expect(stepForEvent(undefined)).toBeNull();
  });
});
