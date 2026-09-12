import { describe, expect, test } from "@jest/globals";

import { DEV_ROOM_CODE_PATTERN, isDevRoomCode } from "../devRooms.js";

describe("isDevRoomCode", () => {
  test("accepts TESTROOM followed by digits", () => {
    for (const code of ["TESTROOM01", "TESTROOM1", "TESTROOM99"]) {
      expect(isDevRoomCode(code)).toBe(true);
    }
  });

  test("rejects every other room code", () => {
    for (const code of ["testroom01", "TESTROOM", "ABC123", "TESTROOMAbc", "TESTROOM01X", undefined, null, 42]) {
      expect(isDevRoomCode(code)).toBe(false);
    }
  });

  test("the exported pattern is the single source the check uses", () => {
    for (const code of ["TESTROOM01", "testroom01", "TESTROOM", "TESTROOM01X"]) {
      expect(DEV_ROOM_CODE_PATTERN.test(code)).toBe(isDevRoomCode(code));
    }
  });
});
