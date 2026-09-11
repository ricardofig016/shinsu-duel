import {
  buildSaveState,
  copyLimitView,
  deckSizeView,
  duplicateDeckName,
  normalizeDeckName,
  withCardCopyAdded,
} from "../../pages/decks/deck-view-models.js";

/**
 * The page renders with the limits the deck API reports, so a rules change on
 * the server shows up in the page without a second edit here. These are the
 * paths that read a caller-supplied limits object.
 */
const SERVER_LIMITS = { deckSize: 12, maxCardCopies: 2, maxNameLength: 10 };

describe("deck view models with server-provided limits", () => {
  test("sizes the deck against the reported limit", () => {
    expect(deckSizeView([1, 2, 3], SERVER_LIMITS)).toMatchObject({
      count: 3,
      limit: 12,
      remaining: 9,
      isFull: false,
      isOver: false,
      label: "3 / 12",
    });
    expect(deckSizeView(new Array(13).fill(1), SERVER_LIMITS)).toMatchObject({ isOver: true });
  });

  test("caps copies at the reported limit", () => {
    expect(copyLimitView(["a"], "a", SERVER_LIMITS)).toEqual({ count: 1, limit: 2, reached: false, label: "1 / 2" });
    expect(copyLimitView(["a", "a"], "a", SERVER_LIMITS)).toMatchObject({ reached: true });
    expect(withCardCopyAdded(["a", "a"], "a", SERVER_LIMITS)).toEqual(["a", "a"]);
    expect(withCardCopyAdded(["a"], "a", SERVER_LIMITS)).toEqual(["a", "a"]);
  });

  test("applies the reported name limit", () => {
    expect(normalizeDeckName("a".repeat(10), SERVER_LIMITS)).toBe("a".repeat(10));
    expect(normalizeDeckName("a".repeat(11), SERVER_LIMITS)).toBeNull();
    expect(duplicateDeckName("Wave Control", SERVER_LIMITS)).toBe("Wave copy");
  });

  test("blocks a save by the reported name limit", () => {
    const limits = { maxNameLength: 4 };
    const knownSlugs = new Set(["a"]);

    expect(buildSaveState({ name: "Ok", cards: ["a"], knownSlugs, limits }).enabled).toBe(true);
    expect(buildSaveState({ name: "Too long", cards: ["a"], knownSlugs, limits })).toMatchObject({
      enabled: false,
      blockedReason: "Deck name must be 1-4 characters.",
    });
  });
});
