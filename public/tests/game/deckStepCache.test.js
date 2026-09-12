import { beginDeckStepTracking, shouldReloadDecks, trackedSeat } from "../../pages/game/deckStepCache.js";

const status = (seats, dev = false) => ({ dev, seats });

describe("deck list cache state", () => {
  beforeEach(() => {
    beginDeckStepTracking();
  });

  test("does not reload before this seat has picked", () => {
    const first = shouldReloadDecks(status([{ username: "Alice", deckId: null }]), "Alice");

    expect(first).toBe(false);
    expect(trackedSeat()).toBe("Alice");
  });

  test("does not reload while a pick stands or is replaced", () => {
    shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }]), "Alice");

    expect(shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }]), "Alice")).toBe(false);
    expect(shouldReloadDecks(status([{ username: "Alice", deckId: "D2" }]), "Alice")).toBe(false);
  });

  // The case the page got wrong: the gateway clears the pick during its
  // start-time re-validation, so the seat sees the same list unless the page
  // fetches again.
  test("reloads when the server clears this seat's pick", () => {
    shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }]), "Alice");

    expect(shouldReloadDecks(status([{ username: "Alice", deckId: null }]), "Alice")).toBe(true);
  });

  test("settles after the reload, so a seat with no pick does not refetch forever", () => {
    shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }]), "Alice");
    expect(shouldReloadDecks(status([{ username: "Alice", deckId: null }]), "Alice")).toBe(true);

    expect(shouldReloadDecks(status([{ username: "Alice", deckId: null }]), "Alice")).toBe(false);
    expect(shouldReloadDecks(status([{ username: "Alice", deckId: null }]), "Alice")).toBe(false);
  });

  test("ignores the opponent's seat", () => {
    shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }, { username: "Bob", deckId: "D9" }]), "Alice");

    const both = status([
      { username: "Alice", deckId: "D1" },
      { username: "Bob", deckId: null },
    ]);
    expect(shouldReloadDecks(both, "Alice")).toBe(false);
  });

  test("treats a missing seat and a missing status as no pick", () => {
    shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }]), "Alice");

    expect(shouldReloadDecks({ dev: false }, "Alice")).toBe(true);
    beginDeckStepTracking();
    expect(shouldReloadDecks(undefined, "Alice")).toBe(false);
  });

  test("restarts tracking when the tracked seat changes", () => {
    shouldReloadDecks(status([{ username: "Alice", deckId: "D1" }]), "Alice");

    expect(shouldReloadDecks(status([{ username: "Bob", deckId: null }]), "Bob")).toBe(false);
    expect(trackedSeat()).toBe("Bob");
  });
});
