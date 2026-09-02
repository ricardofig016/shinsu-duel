import {
  DEFAULT_SORT_KEY,
  SORT_KEYS,
  artworkDisplayName,
  buildSearchableText,
  decodeState,
  deriveFacetOptions,
  encodeState,
  filterCards,
  normalizeCriteria,
  sortCards,
} from "../../utils/card-browse.js";

const scoutPosition = { name: "Scout", description: "The scout line." };
const fishermanPosition = { name: "Fisherman", description: "The fisherman line." };

/** View models shaped like `buildCardViewModel` output. */
const units = [
  {
    cardId: 1,
    type: "unit",
    kind: "standard",
    name: "Ashen Knight",
    sobriquet: "The Ember Blade",
    rank: "regular",
    cost: 3,
    maxHp: 40,
    abilities: [{ code: "0", text: "Deal 2 damage to a target." }],
    passiveAbilities: [],
    printedTraits: [
      { code: "lethal", name: "Lethal", description: "Kill what I damage.", iconPath: null },
    ],
    attributes: [
      { code: "hwayeomsa", name: "Hwayeomsa", description: "Fire bearer.", iconPath: null },
    ],
    affiliations: [{ code: "fug", name: "FUG" }],
    positions: { scout: scoutPosition, fisherman: fishermanPosition },
    effects: [],
    rules: [],
    requirements: [],
    evolveTriggers: null,
    igniteTriggers: null,
    artworkPath: null,
  },
  {
    cardId: 2,
    type: "unit",
    kind: "landmark",
    name: "Bell Tower",
    sobriquet: null,
    rank: null,
    cost: 5,
    maxHp: 90,
    abilities: [],
    passiveAbilities: [{ text: "Round start: draw a card." }],
    printedTraits: [],
    attributes: [],
    affiliations: [{ code: "wolhaiksong", name: "Wolhaiksong" }],
    positions: {},
    effects: [],
    rules: ["While this is on the field, units cannot be destroyed."],
    evolveTriggers: null,
    igniteTriggers: null,
    artworkPath: null,
  },
  {
    cardId: 3,
    type: "skill",
    kind: null,
    name: "Crimson Bolt",
    sobriquet: null,
    rank: null,
    cost: 1,
    maxHp: null,
    abilities: [],
    passiveAbilities: [],
    printedTraits: [],
    attributes: [],
    affiliations: [],
    positions: {},
    effects: ["Deal 5 damage to a unit."],
    rules: [],
    requirements: [],
    evolveTriggers: null,
    igniteTriggers: null,
    artworkPath: null,
  },
];

describe("buildSearchableText", () => {
  test("covers printed content and looked-up metadata", () => {
    const text = buildSearchableText(units[0]);
    expect(text).toContain("ashen knight");
    expect(text).toContain("the ember blade");
    expect(text).toContain("deal 2 damage to a target.");
    expect(text).toContain("kill what i damage."); // trait description
    expect(text).toContain("fug"); // affiliation
    expect(text).toContain("scout"); // position
    expect(text).toContain("hwayeomsa"); // attribute
  });

  test("covers landmark rules, passives, and skill effects", () => {
    expect(buildSearchableText(units[1])).toContain("draw a card");
    expect(buildSearchableText(units[2])).toContain("deal 5 damage");
  });

  test("tolerates sparse views", () => {
    expect(buildSearchableText({ name: "Lone" })).toBe("lone");
    expect(buildSearchableText({})).toBe("");
  });
});

describe("filterCards", () => {
  test("returns every card for empty criteria", () => {
    expect(filterCards(units, {})).toEqual(units);
    expect(filterCards(units, normalizeCriteria(null))).toHaveLength(3);
  });

  test("matches text case-insensitively across searchable fields", () => {
    expect(filterCards(units, { text: "EMBER" }).map((view) => view.name)).toEqual(["Ashen Knight"]);
    expect(filterCards(units, { text: "wolhaiksong" }).map((view) => view.name)).toEqual(["Bell Tower"]);
    expect(filterCards(units, { text: "deal 5 damage" })).toHaveLength(1);
  });

  test("text with no match returns nothing", () => {
    expect(filterCards(units, { text: "zeppelin" })).toEqual([]);
  });

  test("single-select facets filter exactly", () => {
    expect(filterCards(units, { type: "unit" })).toHaveLength(2);
    expect(filterCards(units, { type: "skill" }).map((view) => view.name)).toEqual(["Crimson Bolt"]);
    expect(filterCards(units, { kind: "landmark" }).map((view) => view.name)).toEqual(["Bell Tower"]);
    expect(filterCards(units, { rank: "regular" }).map((view) => view.name)).toEqual(["Ashen Knight"]);
  });

  test("multi-select facets match any selected value", () => {
    expect(filterCards(units, { affiliations: ["FUG"] }).map((view) => view.name)).toEqual(["Ashen Knight"]);
    expect(filterCards(units, { affiliations: ["FUG", "Wolhaiksong"] })).toHaveLength(2);
    expect(filterCards(units, { traits: ["Lethal"] })).toHaveLength(1);
    expect(filterCards(units, { positions: ["Fisherman"] })).toHaveLength(1);
  });

  test("facets combine with AND", () => {
    expect(filterCards(units, { type: "unit", kind: "landmark" }).map((view) => view.name)).toEqual(["Bell Tower"]);
    expect(filterCards(units, { type: "unit", text: "bolt" })).toEqual([]);
  });

  test("cost bounds are inclusive and default to the card cost", () => {
    expect(filterCards(units, { costMin: 3 }).map((view) => view.name)).toEqual(["Ashen Knight", "Bell Tower"]);
    expect(filterCards(units, { costMax: 3 }).map((view) => view.name)).toEqual(["Ashen Knight", "Crimson Bolt"]);
    expect(filterCards(units, { costMin: 3, costMax: 3 }).map((view) => view.name)).toEqual(["Ashen Knight"]);
    expect(filterCards(units, { costMin: 3.5, costMax: 4 })).toEqual([]);
  });

  test("does not mutate the input array or criteria", () => {
    const criteria = { affiliations: ["FUG"] };
    const copy = [...units];
    filterCards(units, criteria);
    expect(units).toEqual(copy);
    expect(criteria.affiliations).toEqual(["FUG"]);
  });
});

describe("sortCards", () => {
  test("sorts by name ascending by default and explicitly", () => {
    expect(sortCards(units).map((view) => view.name)).toEqual(["Ashen Knight", "Bell Tower", "Crimson Bolt"]);
    expect(sortCards(units, "name-asc").map((view) => view.name)).toEqual(["Ashen Knight", "Bell Tower", "Crimson Bolt"]);
  });

  test("sorts by name descending", () => {
    expect(sortCards(units, "name-desc").map((view) => view.name)).toEqual(["Crimson Bolt", "Bell Tower", "Ashen Knight"]);
  });

  test("sorts by cost both ways, breaking ties by name", () => {
    const tied = [
      { cardId: 9, name: "Zeta", cost: 2 },
      { cardId: 8, name: "Alpha", cost: 2 },
      { cardId: 7, name: "Mid", cost: 1 },
    ];
    expect(sortCards(tied, "cost-asc").map((view) => view.name)).toEqual(["Mid", "Alpha", "Zeta"]);
    expect(sortCards(tied, "cost-desc").map((view) => view.name)).toEqual(["Zeta", "Alpha", "Mid"]);
  });

  test("sorts case-insensitively and does not mutate the input", () => {
    const mixed = [{ cardId: 1, name: "apple", cost: 1 }, { cardId: 2, name: "Banana", cost: 1 }];
    expect(sortCards(mixed).map((view) => view.name)).toEqual(["apple", "Banana"]);
    expect(mixed.map((view) => view.name)).toEqual(["apple", "Banana"]);
  });

  test("rejects unknown sort keys", () => {
    expect(() => sortCards(units, "hp-desc")).toThrow(TypeError);
  });
});

describe("deriveFacetOptions", () => {
  test("derives distinct sorted values from the views", () => {
    const options = deriveFacetOptions(units);
    expect(options.types).toEqual(["skill", "unit"]);
    expect(options.kinds).toEqual(["landmark", "standard"]);
    expect(options.ranks).toEqual(["regular"]);
    expect(options.affiliations).toEqual(["FUG", "Wolhaiksong"]);
    expect(options.traits).toEqual(["Lethal"]);
    expect(options.positions).toEqual(["Fisherman", "Scout"]);
  });

  test("ignores null facet values", () => {
    const options = deriveFacetOptions([{ cardId: 1, name: "Bare" }]);
    expect(options.types).toEqual([]);
    expect(options.ranks).toEqual([]);
  });
});

describe("artworkDisplayName", () => {
  test("humanizes artwork slugs into card names", () => {
    expect(artworkDisplayName("twenty_fifth_baam")).toBe("Twenty Fifth Baam");
    expect(artworkDisplayName("narumada-ignited")).toBe("Narumada Ignited");
    expect(artworkDisplayName("baam")).toBe("Baam");
  });

  test("rejects unusable stems", () => {
    expect(artworkDisplayName("")).toBe("");
    expect(artworkDisplayName("   ")).toBe("");
    expect(artworkDisplayName(null)).toBe("");
    expect(artworkDisplayName(42)).toBe("");
  });
});

describe("encodeState and decodeState", () => {
  test("omits defaults and empty facets", () => {
    const params = encodeState(normalizeCriteria(null));
    expect([...params.keys()]).toEqual([]);
    expect(encodeState(normalizeCriteria(null), DEFAULT_SORT_KEY).toString()).toBe("");
  });

  test("round-trips a fully populated state", () => {
    const criteria = {
      text: "ember",
      type: "unit",
      kind: "standard",
      rank: "regular",
      affiliations: ["FUG", "Wolhaiksong"],
      traits: ["Lethal"],
      positions: ["Scout"],
      costMin: 1,
      costMax: 5,
    };
    const decoded = decodeState(encodeState(criteria, "cost-desc"));
    expect(decoded).toEqual({ criteria, sortKey: "cost-desc" });
  });

  test("decodeState falls back to defaults for unknown or invalid values", () => {
    const params = new URLSearchParams("sort=bogus&min=abc&type=");
    const decoded = decodeState(params);
    expect(decoded.sortKey).toBe(DEFAULT_SORT_KEY);
    expect(decoded.criteria.costMin).toBeNull();
    expect(decoded.criteria.type).toBeNull();
    expect(decoded.criteria.text).toBe("");
  });

  test("decodeState keeps multi-value facets", () => {
    const params = new URLSearchParams("affiliation=FUG&affiliation=Wolhaiksong&trait=Lethal");
    const decoded = decodeState(params);
    expect(decoded.criteria.affiliations).toEqual(["FUG", "Wolhaiksong"]);
    expect(decoded.criteria.traits).toEqual(["Lethal"]);
  });

  test("exposes the four documented sort keys", () => {
    expect(SORT_KEYS.map((entry) => entry.key)).toEqual(["name-asc", "name-desc", "cost-asc", "cost-desc"]);
  });
});
