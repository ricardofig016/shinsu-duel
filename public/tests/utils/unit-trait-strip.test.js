import { buildTraitStripEntries } from "../../utils/unit-trait-strip.js";

/**
 * The trait strip is what a deployed unit's card face reads as its live state:
 * every trait, then every condition. Its order, its numbers, and its icon
 * fallbacks are pinned here, because the card faces that draw it are DOM code
 * without a harness.
 *
 * Entries carry the shape the unit view model gives them: a trait states its
 * `code` and its effective `value`, a condition its `key` and its `magnitude`.
 */

const unit = {
  runtimeTraits: [
    { code: "resilient", name: "Resilient", description: { segments: ["I take -x damage."] }, iconPath: "/assets/icons/traits/resilient.png", numeric: true, value: 3 },
    { code: "taunt", name: "Taunt", description: null, iconPath: null, numeric: false, value: 1 },
  ],
  conditions: [
    { key: "burned", name: "Burned", description: { segments: ["Take x damage."] }, iconPath: "/assets/icons/conditions/burned.png", numeric: true, magnitude: 4 },
    { key: "blinded", name: "Blinded", description: null, iconPath: "/assets/icons/conditions/blinded.png", numeric: false, magnitude: 1 },
  ],
};

describe("buildTraitStripEntries", () => {
  test("lists every trait before every condition, in the order the unit states them", () => {
    const entries = buildTraitStripEntries(unit);

    expect(entries.map((entry) => entry.code)).toEqual(["resilient", "taunt", "burned", "blinded"]);
  });

  test("states a number only for an entry the catalog marks numeric", () => {
    const entries = buildTraitStripEntries(unit);

    expect(entries.map((entry) => entry.value)).toEqual([3, null, 4, null]);
    expect(entries.map((entry) => entry.title)).toEqual(["Resilient 3", "Taunt", "Burned 4", "Blinded"]);
  });

  test("fills the entry's own value slot with the number it states, keeping the prose's links", () => {
    const entries = buildTraitStripEntries({
      runtimeTraits: [
        {
          code: "resilient",
          name: "Resilient",
          description: { segments: ["Reduces ", { type: "condition", ref: "burned", text: "Burned" }] },
          numeric: true,
          value: 2,
        },
      ],
      conditions: [
        { key: "burned", name: "Burned", description: { segments: ["Take x damage."] }, numeric: true, magnitude: 4 },
      ],
    });

    expect(entries.map((entry) => entry.texts)).toEqual([
      [{ segments: ["Reduces ", { type: "condition", ref: "burned", text: "Burned" }], values: { trait: 2 } }],
      [{ segments: ["Take x damage."], values: { condition: 4 } }],
    ]);
  });

  test("leaves a non-numeric entry's prose unfilled", () => {
    const entries = buildTraitStripEntries({
      runtimeTraits: [{ code: "barrier", name: "Barrier", description: "Negates damage.", numeric: false, value: 1 }],
      conditions: [],
    });

    expect(entries[0].value).toBeNull();
    expect(entries[0].texts).toEqual([{ text: "Negates damage." }]);
  });

  test("falls back to the catalog placeholder icon when the entry carries none", () => {
    const entries = buildTraitStripEntries(unit);
    const taunt = entries.find((entry) => entry.code === "taunt");
    const blinded = entries.find((entry) => entry.code === "blinded");

    expect(taunt.iconPath).toBe("/assets/icons/traits/placeholder.png");
    expect(blinded.iconPath).toBe("/assets/icons/conditions/blinded.png");
  });

  test("keeps a condition's own icon when the catalog carries one", () => {
    const burned = buildTraitStripEntries(unit).find((entry) => entry.code === "burned");

    expect(burned.iconPath).toBe("/assets/icons/conditions/burned.png");
  });

  test("falls back to the code as a name for an entry the catalog cannot name", () => {
    const entries = buildTraitStripEntries({ runtimeTraits: [{ code: "mystery", numeric: false }], conditions: [] });

    expect(entries[0].title).toBe("mystery");
  });

  test("states nothing for a unit with no traits and no conditions", () => {
    expect(buildTraitStripEntries({ runtimeTraits: [], conditions: [] })).toEqual([]);
    expect(buildTraitStripEntries(null)).toEqual([]);
  });
});
