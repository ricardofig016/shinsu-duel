import { EVENTS, ERROR_CODES } from "../../net/protocol.js";
import { EVENTS as CLIENT_EVENTS, ERROR_CODES as CLIENT_ERROR_CODES } from "../../../../public/game/protocol.js";

/**
 * The client ships its own copy of the protocol vocabulary as plain modules,
 * and nothing else compares the two copies. A constant added on one side alone
 * fails silently at runtime, so the parity is asserted here.
 */
describe("protocol vocabulary parity", () => {
  test("both copies carry the same event names", () => {
    expect(CLIENT_EVENTS).toEqual(EVENTS);
  });

  test("both copies carry the same error codes", () => {
    expect(CLIENT_ERROR_CODES).toEqual(ERROR_CODES);
  });
});
