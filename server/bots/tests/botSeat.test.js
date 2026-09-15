import SeededRng from "../../game/utils/SeededRng.js";
import { createBotSeat, deriveBotSeed, parseBotSpec } from "../botSeat.js";

const assemble = (spec, seed = 7) =>
  createBotSeat({
    roomCode: "ROOM01",
    spec,
    seed,
    opponentName: "Alice",
    registry: { get: () => null },
    submitter: { submitAction: () => {}, submitDecision: () => {} },
  });

const build = (spec = { bot: "whatever", deckMethod: "mirror" }, seed = 7) => assemble(spec, seed);

describe("parseBotSpec", () => {
  test("accepts a spec naming a known playstyle and deck method", () => {
    expect(parseBotSpec({ bot: "drunk", deckMethod: "random-owned" })).toEqual({
      bot: "drunk",
      deckMethod: "random-owned",
    });
  });

  test("rejects a missing or unknown spec", () => {
    for (const bad of [
      undefined,
      null,
      "drunk",
      {},
      { bot: "drunk" },
      { deckMethod: "mirror" },
      { bot: "easy", deckMethod: "mirror" },
      { bot: "drunk", deckMethod: "random" },
      { bot: 7, deckMethod: "mirror" },
    ]) {
      expect(parseBotSpec(bad)).toBeNull();
    }
  });
});

describe("createBotSeat", () => {
  test("assembles the seat from the roster with its playstyle and deck method", () => {
    const seat = build();

    expect(seat.botId).toBe("whatever");
    expect(seat.seatName).toBe("[BOT] Whatever");
    expect(seat.deckMethodId).toBe("mirror");
    expect(seat.opponentName).toBe("Alice");
    expect(typeof seat.deckMethod.resolve).toBe("function");
    expect(typeof seat.controller.send).toBe("function");
  });

  test("derives the seat rng deterministically from the room seed", () => {
    expect(deriveBotSeed(7)).toBe(deriveBotSeed(7));
    expect(build().rng.getState()).toEqual(build().rng.getState());
    expect(build({ bot: "whatever", deckMethod: "mirror" }, 8).rng.getState()).not.toEqual(
      build({ bot: "whatever", deckMethod: "mirror" }, 7).rng.getState()
    );
  });

  test("refuses a broken spec instead of defaulting", () => {
    for (const bad of [undefined, { bot: "easy", deckMethod: "mirror" }, { bot: "drunk", deckMethod: "random" }]) {
      expect(() => assemble(bad)).toThrow(TypeError);
    }
  });
});
