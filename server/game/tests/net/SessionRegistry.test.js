import { jest } from "@jest/globals";
import SessionRegistry from "../../net/SessionRegistry.js";

const ARGS = {
  roomCode: "ROOM1",
  usernames: ["Alice", "Bob"],
  seed: 42,
  createGame: () => {
    throw new Error("this test never starts a game");
  },
};

describe("SessionRegistry", () => {
  test("returns one session per room code", () => {
    const registry = new SessionRegistry();
    const session = registry.ensureSession(ARGS);

    expect(registry.ensureSession(ARGS)).toBe(session);
    expect(registry.get("ROOM1")).toBe(session);
    expect(registry.get("ROOM1")).toBe(registry.ensureSession(ARGS));
    expect(registry.size).toBe(1);
  });

  test("get returns null for unknown rooms", () => {
    const registry = new SessionRegistry();
    expect(registry.get("NOPE")).toBeNull();
  });

  test("reset drops every session", () => {
    const registry = new SessionRegistry();
    registry.ensureSession(ARGS);

    registry.reset();

    expect(registry.get("ROOM1")).toBeNull();
    expect(registry.size).toBe(0);
  });

  test("sessions are keyed by room code, not by caller snapshot", () => {
    const registry = new SessionRegistry();
    const first = registry.ensureSession(ARGS);
    const second = registry.ensureSession({ ...ARGS, seed: 999, createGame: () => null });

    expect(second).toBe(first);
    expect(first.seed).toBe(42);
  });

  test("delegates construction to an injected session factory", () => {
    const sentinel = { roomCode: "ROOM1" };
    const createSession = jest.fn(() => sentinel);
    const registry = new SessionRegistry({ createSession });

    expect(registry.ensureSession(ARGS)).toBe(sentinel);
    expect(createSession).toHaveBeenCalledWith(ARGS);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(registry.ensureSession(ARGS)).toBe(sentinel);
  });

  test("rejects a non-function session factory", () => {
    expect(() => new SessionRegistry({ createSession: "nope" })).toThrow(TypeError);
  });
});
