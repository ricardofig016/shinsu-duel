import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeckLibrary } from "./deckLibrary.js";
import { provisionStarterDecks } from "./deckProvisioning.js";

function makeTempLibrary() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-provision-"));
  return createDeckLibrary({ filePath: path.join(directory, "decks.json") });
}

const TEMPLATES = [
  { code: "a", name: "Deck A", cards: ["ashen_knight", "brawn_idol", "cinder_skill"] },
  { code: "b", name: "Deck B", cards: ["dusty_armor", "edgy_unit", "first_thorn"] },
];

describe("provisionStarterDecks", () => {
  test("copies every template into the account", async () => {
    const library = makeTempLibrary();

    const created = await provisionStarterDecks("Alice", { library, decks: TEMPLATES });

    expect(created.map((deck) => deck.name)).toEqual(["Deck A", "Deck B"]);
    expect(await library.listDecks("Alice")).toEqual(created);
    expect(created.every((deck) => deck.owner === "Alice")).toBe(true);
  });

  test("provisions nothing for other users", async () => {
    const library = makeTempLibrary();

    await provisionStarterDecks("Alice", { library, decks: TEMPLATES });

    expect(await library.listDecks("Bob")).toEqual([]);
  });

  test("copies are independent records, not shared templates", async () => {
    const library = makeTempLibrary();

    const [first] = await provisionStarterDecks("Alice", { library, decks: TEMPLATES });
    await library.updateDeck(first.id, "Alice", { name: "Mine now", cards: ["not_in_pool"] });

    expect(await library.getOwnedDeck(first.id, "Alice")).toMatchObject({ name: "Mine now", cards: ["not_in_pool"] });
    expect(TEMPLATES[0]).toMatchObject({ name: "Deck A", cards: ["ashen_knight", "brawn_idol", "cinder_skill"] });
  });

  test("removes copies already created when a later template fails", async () => {
    const library = makeTempLibrary();
    const decks = [TEMPLATES[0], { code: "bad", name: "Broken", cards: "nope" }, TEMPLATES[1]];

    await expect(provisionStarterDecks("Alice", { library, decks })).rejects.toThrow(/array of card slugs/);
    expect(await library.listDecks("Alice")).toEqual([]);
  });
});
