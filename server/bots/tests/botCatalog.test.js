import { BOTS, getBot } from "../botCatalog.js";

describe("botCatalog", () => {
  test("ships the two playstyle bots with identity metadata", () => {
    expect(BOTS.map((bot) => bot.id)).toEqual(["whatever", "drunk"]);
    for (const bot of BOTS) {
      for (const field of ["id", "name", "seatName", "blurb"]) {
        expect(typeof bot[field]).toBe("string");
        expect(bot[field].length).toBeGreaterThan(0);
      }
      expect(bot.seatName).toBe(`[BOT] ${bot.name}`);
    }
  });

  test("resolves a roster entry by id", () => {
    expect(getBot("drunk")).toEqual(BOTS.find((bot) => bot.id === "drunk"));
  });

  test("throws for an unknown id", () => {
    expect(() => getBot("easy")).toThrow('Unknown bot: "easy"');
  });
});
