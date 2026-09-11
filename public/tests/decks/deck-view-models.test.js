import {
  CARD_POOL_PROBLEM,
  DECK_NAME_PROBLEM,
  DECK_SIZE,
  MAX_CARD_COPIES,
  MAX_DECK_NAME_LENGTH,
  buildDeckContents,
  buildDeckRow,
  buildPickerEntries,
  buildPickerEntry,
  buildSaveState,
  buildValidationView,
  copyLimitView,
  countCopies,
  deckSizeView,
  duplicateDeckName,
  isCopyLimitReached,
  normalizeDeckName,
  withCardCopyAdded,
  withCardCopyRemoved,
} from "../../pages/decks/deck-view-models.js";

/** Catalog card view shaped like `GET /cards/data` output; the slug mirrors
 *  the compiled contract (`normalizeName(name)`). */
const cardView = (name, { cost = 1, type = "unit", deckEligible = true } = {}) => ({
  cardId: 1,
  slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
  name,
  cost,
  type,
  kind: "standard",
  rank: "regular",
  positions: {},
  affiliations: {},
  artworkPath: null,
  deckEligible,
});

const entriesBySlug = (cards, testCards = []) =>
  new Map(buildPickerEntries({ cards, testCards }).map((entry) => [entry.slug, entry]));

describe("normalizeDeckName", () => {
  test("trims a usable name", () => {
    expect(normalizeDeckName("  Wave Control  ")).toBe("Wave Control");
  });

  test("accepts a name at the length limit", () => {
    const name = "a".repeat(MAX_DECK_NAME_LENGTH);
    expect(normalizeDeckName(name)).toBe(name);
  });

  test("rejects a name over the length limit", () => {
    expect(normalizeDeckName("a".repeat(MAX_DECK_NAME_LENGTH + 1))).toBeNull();
  });

  test("rejects empty and whitespace-only names", () => {
    expect(normalizeDeckName("")).toBeNull();
    expect(normalizeDeckName("   ")).toBeNull();
  });

  test("rejects names that are not strings", () => {
    expect(normalizeDeckName(null)).toBeNull();
    expect(normalizeDeckName(undefined)).toBeNull();
    expect(normalizeDeckName(42)).toBeNull();
  });
});

describe("duplicateDeckName", () => {
  test("marks the copy in the name", () => {
    expect(duplicateDeckName("Wave Control")).toBe("Wave Control copy");
  });

  test("trims the source name", () => {
    expect(duplicateDeckName("  Wave Control ")).toBe("Wave Control copy");
  });

  test("keeps a long name inside the name limit", () => {
    const copy = duplicateDeckName("a".repeat(MAX_DECK_NAME_LENGTH));

    expect(copy).toHaveLength(MAX_DECK_NAME_LENGTH);
    expect(copy.endsWith(" copy")).toBe(true);
  });

  test("names a copy of an unnamed deck", () => {
    expect(duplicateDeckName("")).toBe("Deck copy");
    expect(duplicateDeckName(null)).toBe("Deck copy");
  });
});

describe("countCopies", () => {
  test("counts copies of every card", () => {
    const counts = countCopies(["c", "a", "c", "c", "a"]);

    expect(counts.get("c")).toBe(3);
    expect(counts.get("a")).toBe(2);
  });

  test("keys cards in the order they first appear", () => {
    expect([...countCopies(["d", "b", "d", "e"]).keys()]).toEqual(["d", "b", "e"]);
  });

  test("counts nothing in an empty or missing list", () => {
    expect(countCopies([]).size).toBe(0);
    expect(countCopies(undefined).size).toBe(0);
  });
});

describe("copyLimitView", () => {
  test("labels the count against the copy limit", () => {
    expect(copyLimitView(["j", "j"], "j")).toEqual({
      count: 2,
      limit: MAX_CARD_COPIES,
      reached: false,
      label: `2 / ${MAX_CARD_COPIES}`,
    });
  });

  test("reports a card the deck does not hold", () => {
    expect(copyLimitView(["j"], "k").count).toBe(0);
    expect(copyLimitView(["j"], "k").label).toBe(`0 / ${MAX_CARD_COPIES}`);
  });

  test("reports the copy limit reached at the limit and beyond", () => {
    expect(copyLimitView(["j", "j", "j"], "j").reached).toBe(true);
    expect(copyLimitView(["j", "j", "j", "j"], "j").reached).toBe(true);
  });
});

describe("isCopyLimitReached", () => {
  test("is false below the copy limit", () => {
    expect(isCopyLimitReached([], "j")).toBe(false);
    expect(isCopyLimitReached(["j"], "j")).toBe(false);
    expect(isCopyLimitReached(["j", "j"], "j")).toBe(false);
  });

  test("is true at the copy limit", () => {
    expect(isCopyLimitReached(["j", "j", "j"], "j")).toBe(true);
  });

  test("counts each card on its own", () => {
    expect(isCopyLimitReached(["j", "j", "j"], "k")).toBe(false);
  });
});

describe("deckSizeView", () => {
  test("counts the cards against the deck size", () => {
    expect(deckSizeView(new Array(DECK_SIZE).fill("j"))).toEqual({
      count: DECK_SIZE,
      limit: DECK_SIZE,
      remaining: 0,
      isFull: true,
      isOver: false,
      label: `${DECK_SIZE} / ${DECK_SIZE}`,
    });
  });

  test("reports the room left in a partial deck", () => {
    const size = deckSizeView(["a", "b", "c"]);

    expect(size.count).toBe(3);
    expect(size.remaining).toBe(DECK_SIZE - 3);
    expect(size.isFull).toBe(false);
    expect(size.isOver).toBe(false);
    expect(size.label).toBe(`3 / ${DECK_SIZE}`);
  });

  test("flags a deck over the deck size", () => {
    const size = deckSizeView(new Array(DECK_SIZE + 2).fill("j"));

    expect(size.count).toBe(DECK_SIZE + 2);
    expect(size.remaining).toBe(-2);
    expect(size.isOver).toBe(true);
    expect(size.isFull).toBe(false);
  });

  test("treats a missing card list as empty", () => {
    expect(deckSizeView(undefined).count).toBe(0);
  });
});

describe("withCardCopyAdded", () => {
  test("appends a copy without touching the source list", () => {
    const cards = ["a", "b"];

    expect(withCardCopyAdded(cards, "c")).toEqual(["a", "b", "c"]);
    expect(cards).toEqual(["a", "b"]);
  });

  test("keeps the copies at the copy limit", () => {
    const cards = ["a", "a", "a"];

    expect(withCardCopyAdded(cards, "a")).toEqual(["a", "a", "a"]);
  });

  test("caps each card on its own", () => {
    expect(withCardCopyAdded(["a", "a", "a"], "b")).toEqual(["a", "a", "a", "b"]);
  });

  test("adds to a deck with no cards", () => {
    expect(withCardCopyAdded(undefined, "b")).toEqual(["b"]);
  });
});

describe("withCardCopyRemoved", () => {
  test("removes one copy and keeps the other cards in order", () => {
    const cards = ["a", "b", "a", "c"];

    expect(withCardCopyRemoved(cards, "a")).toEqual(["a", "b", "c"]);
    expect(cards).toEqual(["a", "b", "a", "c"]);
  });

  test("removes the last copy so the first pick keeps its place", () => {
    expect(withCardCopyRemoved(["a", "b", "a"], "a")).toEqual(["a", "b"]);
  });

  test("keeps the list when the card is absent", () => {
    expect(withCardCopyRemoved(["a", "b"], "c")).toEqual(["a", "b"]);
    expect(withCardCopyRemoved(undefined, "c")).toEqual([]);
  });
});

describe("buildPickerEntry", () => {
  test("carries the card slug, name, and cost", () => {
    const entry = buildPickerEntry(cardView("Ashen Knight", { cost: 4 }));

    expect(entry.slug).toBe("ashen_knight");
    expect(entry.name).toBe("Ashen Knight");
    expect(entry.cost).toBe(4);
    expect(entry.isTest).toBe(false);
    expect(entry.deckEligible).toBe(true);
    expect(entry.marks).toEqual([]);
  });

  test("marks an Unreachable card and keeps it pickable", () => {
    const entry = buildPickerEntry(cardView("Unreachable Unit", { deckEligible: false }));

    expect(entry.deckEligible).toBe(false);
    expect(entry.marks).toEqual([{ code: "unreachable", label: "Unreachable" }]);
  });

  test("marks a test card", () => {
    const entry = buildPickerEntry(cardView("_Test Unit"), { isTest: true });

    expect(entry.isTest).toBe(true);
    expect(entry.marks).toEqual([{ code: "test", label: "Test card" }]);
  });

  test("marks an Unreachable test card with both marks", () => {
    const entry = buildPickerEntry(cardView("_Test Unit", { deckEligible: false }), { isTest: true });

    expect(entry.marks.map((mark) => mark.code)).toEqual(["unreachable", "test"]);
  });

  test("treats a card without the eligibility flag as eligible", () => {
    const entry = buildPickerEntry({ cardId: 12, slug: "ashen_knight", name: "Ashen Knight", cost: 4 });

    expect(entry.deckEligible).toBe(true);
    expect(entry.marks).toEqual([]);
  });

  test("rejects input that is not a card view", () => {
    expect(() => buildPickerEntry(null)).toThrow(TypeError);
    expect(() => buildPickerEntry([])).toThrow(TypeError);
  });
});

describe("buildPickerEntries", () => {
  test("lists the catalog cards, then the test cards", () => {
    const entries = buildPickerEntries({
      cards: [cardView("Ashen Knight"), cardView("Bell Tower")],
      testCards: [cardView("_Test Unit")],
    });

    expect(entries.map((entry) => entry.slug)).toEqual(["ashen_knight", "bell_tower", "test_unit"]);
    expect(entries.map((entry) => entry.isTest)).toEqual([false, false, true]);
  });

  test("offers nothing without a payload", () => {
    expect(buildPickerEntries()).toEqual([]);
    expect(buildPickerEntries({ cards: [cardView("Ashen Knight")] }).map((e) => e.slug)).toEqual(["ashen_knight"]);
  });
});

describe("buildDeckContents", () => {
  test("groups the deck by card in pick order", () => {
    const entries = entriesBySlug([cardView("Ashen Knight", { cost: 2 }), cardView("Bell Tower", { cost: 5 })]);

    const contents = buildDeckContents(["bell_tower", "ashen_knight", "bell_tower"], entries);

    expect(contents.map((group) => group.slug)).toEqual(["bell_tower", "ashen_knight"]);
    expect(contents[0]).toMatchObject({ name: "Bell Tower", count: 2, copiesLabel: "2 copies", cost: 5 });
    expect(contents[1]).toMatchObject({ name: "Ashen Knight", count: 1, copiesLabel: "1 copy" });
  });

  test("keeps the marks of the picked card", () => {
    const entries = entriesBySlug([cardView("Unreachable Unit", { deckEligible: false })], [cardView("_Test Unit")]);

    expect(buildDeckContents(["unreachable_unit", "test_unit"], entries).map((group) => group.marks)).toEqual([
      [{ code: "unreachable", label: "Unreachable" }],
      [{ code: "test", label: "Test card" }],
    ]);
  });

  test("marks a card the catalog does not offer and keeps its slot", () => {
    const entries = entriesBySlug([cardView("Ashen Knight")]);

    const contents = buildDeckContents(["ashen_knight", "not_in_pool"], entries);

    expect(contents[1]).toMatchObject({
      slug: "not_in_pool",
      name: "not_in_pool",
      cost: null,
      isUnknown: true,
      copiesLabel: "1 copy",
    });
    expect(contents[1].marks).toEqual([{ code: "unknown", label: "Unknown card" }]);
  });

  test("groups nothing for an empty deck", () => {
    expect(buildDeckContents([], new Map())).toEqual([]);
  });
});

describe("buildValidationView", () => {
  test("labels a legal deck", () => {
    const view = buildValidationView({ buildable: true, legal: true, problems: [] });

    expect(view).toEqual({
      isLegal: true,
      isBuildable: true,
      label: "Legal",
      problemLabel: "0 problems",
      problems: [],
    });
  });

  test("labels a deck with one problem", () => {
    const view = buildValidationView({ buildable: true, legal: false, problems: ["Deck is too small."] });

    expect(view.isLegal).toBe(false);
    expect(view.label).toBe("Not legal");
    expect(view.problemLabel).toBe("1 problem");
    expect(view.problems).toEqual(["Deck is too small."]);
  });

  test("labels a deck with several problems", () => {
    const view = buildValidationView({ buildable: true, legal: false, problems: ["a", "b"] });

    expect(view.problemLabel).toBe("2 problems");
  });

  test("copies the problem list", () => {
    const problems = ["Deck is too small."];
    const view = buildValidationView({ legal: false, problems });

    view.problems.push("extra");

    expect(problems).toEqual(["Deck is too small."]);
  });

  test("reports a missing validation payload as not legal", () => {
    const view = buildValidationView(undefined);

    expect(view.isLegal).toBe(false);
    expect(view.label).toBe("Not legal");
    expect(view.problems).toEqual([]);
  });

  test("reports a deck whose cards do not exist as unbuildable", () => {
    const view = buildValidationView({ buildable: false, legal: false, problems: ['Card "not_in_pool" does not exist.'] });

    expect(view.isBuildable).toBe(false);
    expect(view.isLegal).toBe(false);
  });
});

describe("buildDeckRow", () => {
  test("shows the deck name, size, and flag", () => {
    const row = buildDeckRow({
      id: "AB12CD",
      name: "Wave Control",
      cards: ["a", "a", "b"],
      buildable: true,
      legal: false,
      problems: ["A deck must contain exactly 30 cards; this one has 3."],
    });

    expect(row.id).toBe("AB12CD");
    expect(row.name).toBe("Wave Control");
    expect(row.cardCount).toBe(3);
    expect(row.sizeLabel).toBe(`3 / ${DECK_SIZE} cards`);
    expect(row.isLegal).toBe(false);
    expect(row.label).toBe("Not legal");
    expect(row.problemLabel).toBe("1 problem");
    expect(row.problems).toEqual(["A deck must contain exactly 30 cards; this one has 3."]);
  });

  test("flags a legal deck", () => {
    const row = buildDeckRow({ id: "AB12CD", name: "Wave Control", cards: [], legal: true, buildable: true, problems: [] });

    expect(row.isLegal).toBe(true);
    expect(row.label).toBe("Legal");
    expect(row.problemLabel).toBe("0 problems");
  });

  test("fills in a deck with no fields", () => {
    const row = buildDeckRow(undefined);

    expect(row).toMatchObject({ id: null, name: "", cardCount: 0, isLegal: false, problems: [] });
  });

  test("copies the problem list", () => {
    const deck = { id: "AB12CD", name: "Wave Control", cards: [], legal: false, problems: ["Deck is too small."] };
    const row = buildDeckRow(deck);

    row.problems.push("extra");

    expect(deck.problems).toEqual(["Deck is too small."]);
  });
});

describe("buildSaveState", () => {
  const knownSlugs = new Set(["ashen_knight", "bell_tower", "cinder_skill"]);

  test("carries the card list the save request sends", () => {
    const cards = ["ashen_knight", "bell_tower", "cinder_skill"];
    const state = buildSaveState({ name: "Wave Control", cards, knownSlugs });

    expect(state.cards).toEqual(["ashen_knight", "bell_tower", "cinder_skill"]);
    expect(state.cards).not.toBe(cards); // the request sends a copy
  });

  test("carries the card list even when the save is blocked", () => {
    const state = buildSaveState({ name: "", cards: ["ashen_knight"], knownSlugs });

    expect(state.cards).toEqual(["ashen_knight"]);
    expect(state.enabled).toBe(false);
  });

  test("enables a save for a named deck of known cards", () => {
    const state = buildSaveState({ name: "Wave Control", cards: ["ashen_knight", "bell_tower", "cinder_skill"], knownSlugs });

    expect(state).toEqual({
      name: "Wave Control",
      cards: ["ashen_knight", "bell_tower", "cinder_skill"],
      unknownSlugs: [],
      enabled: true,
      blockedReason: null,
    });
  });

  test("trims the name it sends", () => {
    expect(buildSaveState({ name: "  Wave Control  ", cards: [], knownSlugs }).name).toBe("Wave Control");
  });

  test("accepts the known card slugs as a list", () => {
    expect(buildSaveState({ name: "Wave Control", cards: ["ashen_knight"], knownSlugs: ["ashen_knight"] }).enabled).toBe(true);
  });

  test("blocks a save without a name", () => {
    const state = buildSaveState({ name: "   ", cards: ["ashen_knight"], knownSlugs });

    expect(state.enabled).toBe(false);
    expect(state.name).toBeNull();
    expect(state.blockedReason).toBe(DECK_NAME_PROBLEM);
  });

  test("blocks a save with a name over the length limit", () => {
    const state = buildSaveState({ name: "a".repeat(MAX_DECK_NAME_LENGTH + 1), cards: [], knownSlugs });

    expect(state.enabled).toBe(false);
    expect(state.name).toBeNull();
    expect(state.blockedReason).toBe(DECK_NAME_PROBLEM);
  });

  test("blocks a save with a card slug the catalog does not have", () => {
    const state = buildSaveState({ name: "Wave Control", cards: ["ashen_knight", "not_in_pool", "not_in_pool"], knownSlugs });

    expect(state.enabled).toBe(false);
    expect(state.name).toBe("Wave Control");
    expect(state.unknownSlugs).toEqual(["not_in_pool"]);
    expect(state.blockedReason).toBe(CARD_POOL_PROBLEM);
  });

  test("reports unknown cards even when the name is invalid too", () => {
    const state = buildSaveState({ name: "", cards: ["not_in_pool"], knownSlugs });

    expect(state.enabled).toBe(false);
    expect(state.unknownSlugs).toEqual(["not_in_pool"]);
    expect(state.blockedReason).toBe(DECK_NAME_PROBLEM);
  });

  test("keeps a deck with rule violations saveable", () => {
    const state = buildSaveState({ name: "Wave Control", cards: new Array(DECK_SIZE + 5).fill("ashen_knight"), knownSlugs });

    expect(state.enabled).toBe(true);
    expect(state.blockedReason).toBeNull();
  });

  test("blocks a save with no catalog loaded", () => {
    const state = buildSaveState({ name: "Wave Control", cards: ["ashen_knight"] });

    expect(state.enabled).toBe(false);
    expect(state.unknownSlugs).toEqual(["ashen_knight"]);
    expect(state.blockedReason).toBe(CARD_POOL_PROBLEM);
  });

  test("enables an empty named deck", () => {
    expect(buildSaveState({ name: "New deck", cards: [], knownSlugs }).enabled).toBe(true);
  });
});
