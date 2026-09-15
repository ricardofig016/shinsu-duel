import MirrorDeckMethod from "../../deckMethods/MirrorDeckMethod.js";

const humanPick = {
  deckId: "ABC123",
  name: "Tower Climb",
  cards: ["baam", "shibisu", "rak"],
  illegal: false,
};

describe("MirrorDeckMethod", () => {
  const method = new MirrorDeckMethod();

  test("fields the human seat's pick, copied", async () => {
    const pick = await method.resolve({ humanPick });

    expect(pick).toEqual({ deckId: "ABC123", name: "Tower Climb", cards: ["baam", "shibisu", "rak"], illegal: false });
    pick.cards.push("mutated");
    expect(humanPick.cards).toHaveLength(3);
  });

  test("mirrors an illegal pick as illegal", async () => {
    const pick = await method.resolve({ humanPick: { ...humanPick, illegal: true } });
    expect(pick.illegal).toBe(true);
  });

  test("throws when the human seat has no pick yet", async () => {
    await expect(method.resolve({ humanPick: null })).rejects.toThrow("needs the human seat's deck pick");
  });
});
