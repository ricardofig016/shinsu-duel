import { DEV_ROOM_CODE_PATTERN, isDevRoomCode } from "../../game/devRooms.js";
import {
  DEV_ROOM_CODE_PATTERN as SERVER_PATTERN,
  isDevRoomCode as serverIsDevRoomCode,
} from "../../../server/game/devRooms.js";

const CODES = [
  "TESTROOM01",
  "TESTROOM123",
  "testroom01",
  "TESTROOM",
  "TESTROOM01X",
  "XTESTROOM01",
  "AB12CD",
  "",
  null,
  undefined,
  42,
];

describe("client dev-room check", () => {
  test("only TESTROOM followed by digits is a dev room", () => {
    expect(isDevRoomCode("TESTROOM01")).toBe(true);
    expect(isDevRoomCode("TESTROOM123")).toBe(true);
    expect(isDevRoomCode("testroom01")).toBe(false);
    expect(isDevRoomCode("TESTROOM")).toBe(false);
    expect(isDevRoomCode("TESTROOM01X")).toBe(false);
    expect(isDevRoomCode("AB12CD")).toBe(false);
  });

  test("a non-string code is never a dev room", () => {
    for (const code of ["", null, undefined, 42]) expect(isDevRoomCode(code)).toBe(false);
  });

  test("the pattern and the verdicts match the server's", () => {
    expect(String(DEV_ROOM_CODE_PATTERN)).toBe(String(SERVER_PATTERN));
    for (const code of CODES) {
      expect(isDevRoomCode(code)).toBe(serverIsDevRoomCode(code));
    }
  });
});
