import { buildUnitHeaderIcons } from "../../utils/unit-header-icons.js";

/**
 * The header-icon list is the one thing both card faces draw from, so its
 * order, its tooltip sources, and the cases where it states nothing are
 * pinned here (the components that lay the icons out are DOM code without a
 * harness).
 */

const glossary = {
  types: { equipment: { name: "Equipment", description: "Attached to a unit." } },
  concepts: {
    evolve: { name: "Evolve", description: { segments: ["Evolves when its trigger is met."] } },
    ignition: { name: "Ignition", description: { segments: ["Ignites when its trigger is met."] } },
    passives: { name: "Passives", description: { segments: ["Always active."] } },
    requirements: { name: "Requirements", description: { segments: ["Must be met."] } },
  },
};

const attribute = {
  code: "hwayeomsa",
  name: "Hwayeomsa",
  title: "Guide - Hwayeomsa",
  description: { segments: ["A fire user."] },
  effect: [{ segments: ["Generates a fire charge."] }],
  iconPath: "/assets/icons/attributes/hwayeomsa.png",
};

describe("buildUnitHeaderIcons", () => {
  test("draws one equipment icon for any number of attachments", () => {
    const entries = buildUnitHeaderIcons({ equipmentAttachments: ["Narumada", "Blue Thryssa"] }, glossary);

    expect(entries).toHaveLength(1);
    expect(entries[0].iconPath).toBe("/assets/icons/other/equipment.png");
    expect(entries[0].title).toBe("Equipment");
    expect(entries[0].texts).toEqual(["Narumada", "Blue Thryssa"]);
  });

  test("keeps the card-vertical header order: equipment, attributes, evolve, ignition, passives, requirements", () => {
    const entries = buildUnitHeaderIcons(
      {
        equipmentAttachments: ["Narumada"],
        attributes: [attribute],
        evolveTriggers: [[{ segments: ["On deploy."] }]],
        igniteTriggers: ["On death."],
        passiveAbilities: [{ text: ["Always watching."] }],
        requirements: ["A Viole unit."],
      },
      glossary
    );

    expect(entries.map((entry) => entry.iconPath)).toEqual([
      "/assets/icons/other/equipment.png",
      "/assets/icons/attributes/hwayeomsa.png",
      "/assets/icons/other/evolve.png",
      "/assets/icons/other/ignition.png",
      "/assets/icons/other/passive.png",
      "/assets/icons/other/requirements.png",
    ]);
  });

  test("explains a concept icon with the card's own text, then the glossary description", () => {
    const entries = buildUnitHeaderIcons({ passiveAbilities: [{ text: ["Always watching."] }] }, glossary);

    expect(entries).toHaveLength(1);
    expect(entries[0].title).toBe("Passives");
    expect(entries[0].texts).toEqual([
      { segments: ["Always watching."] },
      { segments: ["Always active."], style: "italic" },
    ]);
  });

  test("states an attribute's title, its effect lines, then its flavor", () => {
    const [entry] = buildUnitHeaderIcons({ attributes: [attribute] }, glossary);

    expect(entry.title).toBe("Guide - Hwayeomsa");
    expect(entry.texts).toEqual([
      { segments: ["Generates a fire charge."] },
      { segments: ["A fire user."], style: "italic" },
    ]);
  });

  test("carries no icon when the model states no feature", () => {
    expect(buildUnitHeaderIcons({}, glossary)).toEqual([]);
    expect(buildUnitHeaderIcons(null, glossary)).toEqual([]);
  });

  test("drops an entry whose icon or title the source cannot supply", () => {
    const entries = buildUnitHeaderIcons(
      { attributes: [{ ...attribute, iconPath: null }, { ...attribute, name: null, title: null }] },
      glossary
    );

    expect(entries).toEqual([]);
  });

  test("states nothing for a feature the glossary cannot explain", () => {
    // Without the glossary there is no concept name to title the tooltip with,
    // so the trigger icons do not draw; the card's own attributes still do.
    const attributes = buildUnitHeaderIcons({ evolveTriggers: ["On deploy."], attributes: [attribute] }, null);

    expect(attributes.map((entry) => entry.iconPath)).toEqual(["/assets/icons/attributes/hwayeomsa.png"]);
    expect(buildUnitHeaderIcons({ passiveAbilities: [{ text: ["Watching."] }] }, null)).toEqual([]);
  });

  test("names the equipment tooltip generically when the glossary is unavailable", () => {
    const [entry] = buildUnitHeaderIcons({ equipmentAttachments: ["Narumada"] }, null);

    expect(entry.title).toBe("Equipment");
    expect(entry.texts).toEqual(["Narumada"]);
  });

  test("ignores blank attachment names", () => {
    expect(buildUnitHeaderIcons({ equipmentAttachments: ["", "  ", null] }, glossary)).toEqual([]);
  });

  test("drops a concept whose own text list is empty", () => {
    expect(buildUnitHeaderIcons({ evolveTriggers: [], requirements: [] }, glossary)).toEqual([]);
  });
});
