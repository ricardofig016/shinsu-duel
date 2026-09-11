import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDeckLibrary } from "./deckLibrary.js";

function makeTempLibrary() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-decks-"));
  return createDeckLibrary({ filePath: path.join(directory, "decks.json") });
}

const CARDS = ["ashen_knight", "brawn_idol", "cinder_skill"];

describe("deckLibrary", () => {
  test("creates a deck and lists it for its owner", async () => {
    const library = makeTempLibrary();

    const created = await library.createDeck({ owner: "Alice", name: "Test Deck", cards: CARDS });

    expect(created.id).toMatch(/^[0-9A-Z]{6}$/);
    expect(created.updatedAt).toEqual(expect.any(String));
    expect(created).toMatchObject({ owner: "Alice", name: "Test Deck", cards: CARDS });

    const listed = await library.listDecks("Alice");
    expect(listed).toEqual([created]);
  });

  test("creates the storage file on first read", async () => {
    const library = makeTempLibrary();

    expect(await library.listDecks("Alice")).toEqual([]);
    expect(fs.existsSync(library.filePath)).toBe(true);
  });

  test("issues distinct ids", async () => {
    const library = makeTempLibrary();

    const ids = new Set();
    for (let i = 0; i < 20; i++) {
      const deck = await library.createDeck({ owner: "Alice", name: `Deck ${i}`, cards: CARDS });
      ids.add(deck.id);
    }
    expect(ids.size).toBe(20);
  });

  test("lists decks by name and isolates owners", async () => {
    const library = makeTempLibrary();
    await library.createDeck({ owner: "Alice", name: "Zulu", cards: CARDS });
    await library.createDeck({ owner: "Alice", name: "Alpha", cards: CARDS });
    await library.createDeck({ owner: "Bob", name: "Bravo", cards: CARDS });

    expect((await library.listDecks("Alice")).map((deck) => deck.name)).toEqual(["Alpha", "Zulu"]);
    expect((await library.listDecks("Bob")).map((deck) => deck.name)).toEqual(["Bravo"]);
    expect(await library.listDecks("Nobody")).toEqual([]);
  });

  test("gets a deck only for its owner", async () => {
    const library = makeTempLibrary();
    const created = await library.createDeck({ owner: "Alice", name: "Test Deck", cards: CARDS });

    expect(await library.getOwnedDeck(created.id, "Alice")).toEqual(created);
    expect(await library.getOwnedDeck(created.id, "Bob")).toBeNull();
    expect(await library.getOwnedDeck("NOPE01", "Alice")).toBeNull();
  });

  test("updates a deck only for its owner", async () => {
    const library = makeTempLibrary();
    const created = await library.createDeck({ owner: "Alice", name: "Test Deck", cards: CARDS });

    const updated = await library.updateDeck(created.id, "Alice", { name: "Renamed", cards: ["not_in_pool"] });
    expect(updated).toMatchObject({ id: created.id, owner: "Alice", name: "Renamed", cards: ["not_in_pool"] });
    expect(await library.getOwnedDeck(created.id, "Alice")).toEqual(updated);

    expect(await library.updateDeck(created.id, "Bob", { name: "Stolen", cards: ["not_in_pool"] })).toBeNull();
    expect((await library.getOwnedDeck(created.id, "Alice")).name).toBe("Renamed");
  });

  test("deletes a deck only for its owner", async () => {
    const library = makeTempLibrary();
    const created = await library.createDeck({ owner: "Alice", name: "Test Deck", cards: CARDS });

    expect(await library.deleteDeck(created.id, "Bob")).toBe(false);
    expect(await library.deleteDeck(created.id, "Alice")).toBe(true);
    expect(await library.listDecks("Alice")).toEqual([]);
    expect(await library.deleteDeck(created.id, "Alice")).toBe(false);
  });

  test("returns copies so callers cannot mutate stored state", async () => {
    const library = makeTempLibrary();
    const created = await library.createDeck({ owner: "Alice", name: "Test Deck", cards: CARDS });

    created.cards.push("not_in_pool");
    expect((await library.getOwnedDeck(created.id, "Alice")).cards).toEqual(CARDS);
  });

  test("rejects malformed records", async () => {
    const library = makeTempLibrary();

    await expect(library.createDeck({ owner: "Alice", name: "Test Deck", cards: "nope" })).rejects.toThrow(/array of card slugs/);
    await expect(library.createDeck({ owner: "Alice", name: "Test Deck", cards: ["a", 2] })).rejects.toThrow(/array of card slugs/);
    await expect(library.createDeck({ owner: "Alice", name: "Test Deck", cards: [""] })).rejects.toThrow(/array of card slugs/);
    await expect(library.createDeck({ owner: "", name: "Test Deck", cards: CARDS })).rejects.toThrow(/owner is required/);
  });
});
