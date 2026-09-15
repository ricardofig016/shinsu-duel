import MirrorDeckMethod from "../../deckMethods/MirrorDeckMethod.js";

describe("MirrorDeckMethod", () => {
  const method = new MirrorDeckMethod();

  test("fields the human seat's re-read deck, copied", async () => {
    const humanDeck = { name: "Tower Climb", cards: ["baam", "shibisu", "rak"] };
    const pick = await method.resolve({ humanDeck });

    expect(pick.deckId).toBe("mirrored");
    expect(pick).toMatchObject({ name: "Tower Climb", cards: ["baam", "shibisu", "rak"], illegal: false });
    pick.cards.push("mutated");
    expect(humanDeck.cards).toHaveLength(3);
  });

  test("mirrors whatever the human seat plays at start time, not an earlier snapshot", async () => {
    const pick = await method.resolve({ humanDeck: { name: "Edited Late", cards: ["baam"] } });
    expect(pick).toMatchObject({ name: "Edited Late", cards: ["baam"] });
  });

  test("throws when the human seat has no deck to mirror", async () => {
    await expect(method.resolve({ humanDeck: null })).rejects.toThrow("needs the human seat's re-read deck");
  });
});
