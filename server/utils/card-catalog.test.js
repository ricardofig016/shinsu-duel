import { createGameServer } from "../createGameServer.js";
import cardsData from "../data/cards.json" with { type: "json" };
import { buildCatalogViews, findOrphanArtworks, isTestCard } from "./card-catalog.js";

const unitEntry = {
  cardId: 10,
  type: "unit",
  name: "Ashen Knight",
  cost: 3,
  hp: 40,
  kind: "standard",
  positions: ["scout"],
  traits: [{ code: "lethal" }],
  attributes: ["hwayeomsa"],
  affiliations: ["fug"],
  abilities: [],
  passives: [],
  artworkPath: "/assets/images/artworks/ashen_knight.png",
};

const skillEntry = {
  cardId: 11,
  type: "skill",
  name: "Falling Petal",
  cost: 2,
  effects: [{ type: "deal_damage", raw: "Deal 2 damage." }],
};

const testEntry = {
  cardId: 12,
  type: "unit",
  name: "_Test Phantom",
  cost: 1,
  hp: 10,
};

const nearMissEntry = {
  cardId: 13,
  type: "skill",
  name: "Testian Ritual",
  cost: 2,
  effects: [],
};

const catalog = {
  10: unitEntry,
  11: skillEntry,
  12: testEntry,
  13: nearMissEntry,
};

describe("isTestCard", () => {
  test("matches the _Test name prefix case-insensitively", () => {
    expect(isTestCard({ name: "_Test Phantom" })).toBe(true);
    expect(isTestCard({ name: "_test phantom" })).toBe(true);
  });

  test("does not match names that merely contain or resemble the prefix", () => {
    expect(isTestCard({ name: "Testian Ritual" })).toBe(false);
    expect(isTestCard({ name: "Testing Grounds" })).toBe(false);
    expect(isTestCard(unitEntry)).toBe(false);
  });

  test("rejects cards without a usable name", () => {
    expect(isTestCard({})).toBe(false);
    expect(isTestCard({ name: 42 })).toBe(false);
    expect(isTestCard(null)).toBe(false);
  });
});

describe("buildCatalogViews", () => {
  test("excludes test cards by default and keeps near-misses", () => {
    const views = buildCatalogViews(catalog);
    expect(views.map((view) => view.name)).toEqual(["Ashen Knight", "Falling Petal", "Testian Ritual"]);
  });

  test("includes test cards when asked", () => {
    const views = buildCatalogViews(catalog, { includeTest: true });
    expect(views.map((view) => view.name)).toContain("_Test Phantom");
    expect(views).toHaveLength(4);
  });

  test("projects views through Card.toSanitizedObject, not raw entries", () => {
    const [view] = buildCatalogViews({ 10: unitEntry });
    expect(view.cardId).toBe(10);
    expect(view.maxHp).toBe(40); // compiled `hp` becomes the client `maxHp`
    expect(view.abilities).toEqual([]);
    expect(view.passiveAbilities).toEqual([]); // compiled `passives` renames
    expect(view.traits.lethal).toMatchObject({
      name: "Lethal",
      iconPath: "/assets/icons/traits/lethal.png",
    }); // stamped from the trait registry; `flattenCard` adds the code client-side
    expect(view.affiliations.fug).toMatchObject({ name: "FUG" });
    expect(view.artworkPath).toBe("/assets/images/artworks/ashen_knight.png");
    expect(view.cost).toBe(3);
    expect(view.owner).toBeNull();
  });

  test("throws no test-card views into orphan computations implicitly", () => {
    // Views carry artworkPath only when the compiler stamped it; a view built
    // from an entry without artwork claims nothing.
    const [skillView] = buildCatalogViews({ 11: skillEntry });
    expect(skillView.artworkPath).toBeNull();
  });
});

describe("findOrphanArtworks", () => {
  const views = [
    { name: "Ashen Knight", artworkPath: "/assets/images/artworks/ashen_knight.png" },
    { name: "Bare Card", artworkPath: null },
    { name: "Weird", artworkPath: "relative\\path\\windows_style.png" },
  ];

  test("returns artwork files no card claims", () => {
    const files = ["ashen_knight.png", "unclaimed_art.png", "windows_style.png"];
    expect(findOrphanArtworks(views, files)).toEqual(["unclaimed_art.png"]);
  });

  test("claims nothing when no card carries artwork", () => {
    expect(findOrphanArtworks([{ name: "Bare", artworkPath: null }], ["a.png"])).toEqual(["a.png"]);
  });

  test("ignores non-png names only as far as the caller passed them", () => {
    expect(findOrphanArtworks(views, ["notes.txt", "unclaimed.png"])).toEqual(["notes.txt", "unclaimed.png"]);
  });
});

describe("cards route", () => {
  let server;
  let baseUrl;

  beforeAll(async () => {
    ({ server } = createGameServer({ loadRoom: async () => null, logToFile: false }));
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    server.closeAllConnections?.();
  });

  const compiledCount = Object.keys(cardsData).length;
  const compiledTestCount = Object.values(cardsData).filter(isTestCard).length;

  test("GET /cards/data serves every non-test card view", async () => {
    const response = await fetch(`${baseUrl}/cards/data`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cards).toHaveLength(compiledCount - compiledTestCount);
    expect(payload.cards.some((view) => isTestCard(view))).toBe(false);
    expect(payload.testCards).toBeUndefined();
    expect(payload.orphanArtworks).toBeUndefined();
    for (const view of payload.cards) {
      expect(typeof view.name).toBe("string");
      expect(typeof view.cardId).toBe("number");
    }
  });

  test("GET /cards/data?dev=true adds test cards and orphan artworks", async () => {
    const response = await fetch(`${baseUrl}/cards/data?dev=true`);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.cards).toHaveLength(compiledCount - compiledTestCount);
    expect(payload.testCards).toHaveLength(compiledTestCount);
    for (const view of payload.testCards) expect(isTestCard(view)).toBe(true);

    const claimed = new Set(
      [...payload.cards, ...payload.testCards]
        .map((view) => view.artworkPath?.split("/").pop())
        .filter(Boolean)
    );
    const expectedOrphans = (await import("node:fs")).readdirSync("public/assets/images/artworks")
      .filter((name) => name.endsWith(".png"))
      .filter((name) => !claimed.has(name))
      .sort();
    expect(payload.orphanArtworks.map((orphan) => orphan.name)).toEqual(
      expectedOrphans.map((name) => name.replace(/\.png$/, ""))
    );
    for (const orphan of payload.orphanArtworks) {
      expect(orphan.artworkPath).toBe(`/assets/images/artworks/${orphan.name}.png`);
    }
  });

  test("dev only activates on the exact value true", async () => {
    const response = await fetch(`${baseUrl}/cards/data?dev=1`);
    const payload = await response.json();
    expect(payload.testCards).toBeUndefined();
  });

  test("GET /cards serves the page", async () => {
    const response = await fetch(`${baseUrl}/cards`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain('src="/pages/cards/script.js"');
  });
});
