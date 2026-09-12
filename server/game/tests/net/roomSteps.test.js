import fs from "node:fs";
import path from "node:path";
import {
  STEP,
  STEP_PATHS,
  STEP_DOCUMENTS,
  roomStep,
  stepPath,
  stepDocument,
} from "../../net/roomSteps.js";
import {
  STEP as CLIENT_STEP,
  STEP_PATHS as CLIENT_STEP_PATHS,
  stepPath as clientStepPath,
} from "../../../../public/game/steps.js";

describe("room steps", () => {
  test("a room with no session is waiting for its second player", () => {
    expect(roomStep({ session: null })).toBe(STEP.WAITING);
    expect(roomStep({})).toBe(STEP.WAITING);
  });

  test("an unstarted session is the deck step", () => {
    expect(roomStep({ session: { isStarted: false } })).toBe(STEP.DECK);
  });

  test("a started session is the board", () => {
    expect(roomStep({ session: { isStarted: true } })).toBe(STEP.BOARD);
  });

  test("each step has one address, and the board keeps the bare room address", () => {
    expect(stepPath("AB12CD", STEP.WAITING)).toBe("/game/AB12CD/waiting");
    expect(stepPath("AB12CD", STEP.DECK)).toBe("/game/AB12CD/deck");
    expect(stepPath("AB12CD", STEP.BOARD)).toBe("/game/AB12CD");
    expect(() => stepPath("AB12CD", "lobby")).toThrow(TypeError);
    expect(() => stepDocument("lobby")).toThrow(TypeError);
  });

  test("every step document exists on disk", () => {
    for (const step of Object.values(STEP)) {
      expect(fs.existsSync(stepDocument(step))).toBe(true);
      expect(stepDocument(step)).toBe(path.resolve(STEP_DOCUMENTS[step]));
    }
  });

  test("the client mirrors the step vocabulary and the addresses", () => {
    expect(CLIENT_STEP).toEqual(STEP);
    expect(CLIENT_STEP_PATHS).toEqual(STEP_PATHS);
    for (const step of Object.values(STEP)) {
      expect(clientStepPath("AB12CD", step)).toBe(stepPath("AB12CD", step));
    }
  });
});
