import { buildCardBackSections, buildUnitHeaderIcons } from "../../utils/unit-header-icons.js";

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

describe("the card's back sections", () => {
  test("reads the header list in order, keeping only the card's game text", () => {
    const sections = buildCardBackSections(
      {
        equipmentAttachments: ["Narumada"],
        attributes: [attribute],
        evolveTriggers: [["On deploy."]],
        passiveAbilities: [{ text: ["Always watching."] }],
        requirements: [["A Viole unit."]],
      },
      glossary
    );

    expect(sections.map((section) => section.title)).toEqual([
      "Guide - Hwayeomsa",
      "Evolve",
      "Passives",
      "Requirements",
    ]);
    // the attribute keeps its effect line and drops its lore; a concept keeps
    // the card's own text and drops the glossary description
    expect(sections[0].texts).toEqual([{ segments: ["Generates a fire charge."] }]);
    expect(sections[1].texts).toEqual([{ segments: ["On deploy."] }]);
    expect(sections[2].texts).toEqual([{ segments: ["Always watching."] }]);
    expect(sections[3].texts).toEqual([{ segments: ["A Viole unit."] }]);
  });

  test("keeps an equipment attachment off the back, whatever it holds", () => {
    const sections = buildCardBackSections({ equipmentAttachments: ["Narumada"] }, glossary);

    expect(sections).toEqual([]);
  });

  test("drops a section with no game text, and reads nothing as no back at all", () => {
    // an attribute with no effect line has nothing to say on the back; the card
    // face still draws its icon, and the card simply does not turn over
    const loreOnly = { ...attribute, effect: [] };
    expect(buildCardBackSections({ attributes: [loreOnly] }, glossary)).toEqual([]);
    expect(buildCardBackSections({}, glossary)).toEqual([]);
    expect(buildCardBackSections(null, glossary)).toEqual([]);
  });

  test("states a card's attributes without the glossary, which the concepts need", () => {
    const sections = buildCardBackSections({ attributes: [attribute], requirements: ["A Viole unit."] }, null);

    expect(sections.map((section) => section.title)).toEqual(["Guide - Hwayeomsa"]);
  });

  test("describes each entry with the same kind and game text the icon list carries", () => {
    const icons = buildUnitHeaderIcons({ equipmentAttachments: ["Narumada"], attributes: [attribute] }, glossary);

    expect(icons.map((icon) => icon.kind)).toEqual(["equipment", "attribute"]);
    expect(icons[0].gameTexts).toEqual(["Narumada"]);
    expect(icons[1].gameTexts).toEqual([{ segments: ["Generates a fire charge."] }]);
  });
});
