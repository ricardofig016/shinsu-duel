import { buildCatalogIndex } from "../../utils/card-catalog.js";

const views = [
  { cardId: 3, slug: "third", name: "Third Unit", type: "unit" },
  { cardId: 1, slug: "first", name: "First Skill", type: "skill" },
  { cardId: 1, slug: "duplicate-id", name: "Duplicate Id", type: "unit" },
  { cardId: 4, slug: "first", name: "duplicate name", type: "unit" },
];

describe("buildCatalogIndex", () => {
  test("indexes card views by cardId, slug, and case-insensitive name", () => {
    const index = buildCatalogIndex(views);

    expect(index.byId.get(1).name).toBe("First Skill");
    expect(index.byId.get(3).slug).toBe("third");
    expect(index.bySlug.get("first").name).toBe("First Skill");
    expect(index.byName.get("third unit").cardId).toBe(3);
  });

  test("keeps the first view per key over later duplicates", () => {
    const index = buildCatalogIndex(views);

    expect(index.byId.get(1).slug).toBe("first");
    expect(index.bySlug.get("first").cardId).toBe(1);
    expect(index.byName.get("duplicate name").cardId).toBe(4);
  });

  test("ignores malformed entries and tolerates absence", () => {
    const index = buildCatalogIndex([{ cardId: "x" }, { slug: "" }, { name: null }, null, "junk"]);

    expect(index.byId.size).toBe(0);
    expect(index.bySlug.size).toBe(0);
    expect(index.byName.size).toBe(0);
    expect(buildCatalogIndex(undefined).byId.size).toBe(0);
  });
});
