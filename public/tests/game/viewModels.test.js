import {
  MAX_NORMAL_SHINSU,
  MAX_RECHARGED_SHINSU,
  buildCardViewModel,
  buildUnitViewModel,
  buildHandCardViewModel,
  buildShinsuViewModel,
  buildRoundViewModel,
  buildGameOverViewModel,
} from "../../game/viewModels.js";

const unitView = {
  id: "unit-1",
  owner: "Alice",
  currentHp: 3,
  line: "frontline",
  placedPositionCode: "scout",
  chosenPositionCode: "light_bearer",
  card: {
    cardId: 10001,
    type: "unit",
    kind: "standard",
    name: "Test Scout",
    sobriquet: "The Lookout",
    artworkPath: "/assets/images/artworks/test_scout.png",
    cost: 2,
    effectiveCost: 1,
    maxHp: 4,
    abilities: [{ type: "hand_peek", raw: "Peek at the opponent's hand." }],
    passiveAbilities: [{ raw: "Always watching." }],
    traits: { scout: { name: "Scout", description: "Moves first.", iconPath: "/assets/icons/traits/scout.png" } },
    affiliations: { sweet_and_sour: { name: "Team Sweet and Sour" } },
    positions: {
      scout: { name: "Scout", description: "Front line scout.", line: "frontline", iconPath: "/assets/icons/positions/scout.png" },
      light_bearer: { name: "Light Bearer", description: "Back line support.", line: "backline", iconPath: "/assets/icons/positions/light-bearer.png" },
    },
  },
  conditions: [{ key: "poisoned", magnitude: 2 }],
  equipmentAttachments: ["Test Equipment"],
  grantedAbilities: [
    {
      abilityCode: "granted:equip-9:deal_damage",
      ability: { type: "deal_damage", raw: "Deal 2 damage." },
      sourceId: "equip-9",
    },
  ],
  traits: ["scout", "fearless"],
};

describe("buildUnitViewModel", () => {
  test("flattens the card fields and the unit runtime state", () => {
    const model = buildUnitViewModel(unitView);

    expect(model.id).toBe("unit-1");
    expect(model.owner).toBe("Alice");
    expect(model.currentHp).toBe(3);
    expect(model.name).toBe("Test Scout");
    expect(model.sobriquet).toBe("The Lookout");
    expect(model.effectiveCost).toBe(1);
    expect(model.passiveAbilities).toEqual([{ text: "Always watching." }]);
  });

  test("addresses native abilities by index and shows the raw text", () => {
    const model = buildUnitViewModel(unitView);

    expect(model.abilities).toEqual([
      { code: "0", text: "Peek at the opponent's hand." },
    ]);
  });

  test("addresses granted abilities by their registry code", () => {
    const model = buildUnitViewModel(unitView);

    expect(model.grantedAbilities).toEqual([
      {
        abilityCode: "granted:equip-9:deal_damage",
        sourceId: "equip-9",
        text: "Deal 2 damage.",
      },
    ]);
  });

  test("carries printed traits, runtime traits, and conditions with magnitudes", () => {
    const model = buildUnitViewModel(unitView);

    expect(model.printedTraits).toEqual([
      { code: "scout", name: "Scout", description: "Moves first.", iconPath: "/assets/icons/traits/scout.png" },
    ]);
    expect(model.runtimeTraits).toEqual(["scout", "fearless"]);
    expect(model.conditions).toEqual([{ key: "poisoned", magnitude: 2 }]);
  });

  test("carries equipment attachments, granted abilities, and both positions", () => {
    const model = buildUnitViewModel(unitView);

    expect(model.equipmentAttachments).toEqual(["Test Equipment"]);
    expect(model.grantedAbilities[0].abilityCode).toBe("granted:equip-9:deal_damage");
    expect(model.placedPositionCode).toBe("scout");
    expect(model.chosenPositionCode).toBe("light_bearer");
    expect(Object.keys(model.positions)).toEqual(["scout", "light_bearer"]);
  });

  test("defaults missing optional fields for landmark-style units", () => {
    const model = buildUnitViewModel({
      id: "unit-2",
      card: { name: "Landmark", positions: {} },
    });

    expect(model.placedPositionCode).toBeNull();
    expect(model.chosenPositionCode).toBeNull();
    expect(model.conditions).toEqual([]);
    expect(model.equipmentAttachments).toEqual([]);
    expect(model.grantedAbilities).toEqual([]);
    expect(model.runtimeTraits).toEqual([]);
    expect(model.owner).toBeNull();
  });

  test("rejects payloads without a card", () => {
    expect(() => buildUnitViewModel(null)).toThrow(TypeError);
    expect(() => buildUnitViewModel({ id: "unit-3" })).toThrow(TypeError);
  });
});

describe("buildCardViewModel", () => {
  test("flattens a readable hand card", () => {
    const model = buildCardViewModel({
      cardId: 10002,
      type: "skill",
      name: "Test Skill",
      cost: 3,
      effectiveCost: 2,
      maxHp: null,
      abilities: [],
      traits: {},
      affiliations: {},
      positions: {},
    });

    expect(model.cardId).toBe(10002);
    expect(model.type).toBe("skill");
    expect(model.effectiveCost).toBe(2);
    expect(model.printedTraits).toEqual([]);
    expect(model.affiliations).toEqual([]);
  });

  test("marks a hidden card view through its null card id", () => {
    const model = buildCardViewModel({});
    expect(model.cardId).toBeNull();
  });

  test("rejects non-object views", () => {
    expect(() => buildCardViewModel(null)).toThrow(TypeError);
    expect(() => buildCardViewModel("card")).toThrow(TypeError);
  });
});

describe("buildHandCardViewModel", () => {
  test("keeps the hand index and hides cards without a card id", () => {
    const readable = buildHandCardViewModel({ cardId: 7, name: "Known" }, 2);
    const hidden = buildHandCardViewModel({}, 0);

    expect(readable).toMatchObject({ index: 2, isHidden: false });
    expect(hidden).toMatchObject({ index: 0, isHidden: true });
  });

  test("rejects invalid indexes", () => {
    expect(() => buildHandCardViewModel({ cardId: 7 }, -1)).toThrow(TypeError);
    expect(() => buildHandCardViewModel({ cardId: 7 }, 1.5)).toThrow(TypeError);
  });
});

describe("buildShinsuViewModel", () => {
  test("fills available, spent, and unavailable circles in order", () => {
    const model = buildShinsuViewModel({ normalAvailable: 2, normalSpent: 3, recharged: 1 });

    expect(model.normal).toEqual([
      "available",
      "available",
      "spent",
      "spent",
      "spent",
      ...Array(MAX_NORMAL_SHINSU - 5).fill("unavailable"),
    ]);
    expect(model.recharged).toEqual(["available", "spent"]);
    expect(model.normal).toHaveLength(MAX_NORMAL_SHINSU);
    expect(model.recharged).toHaveLength(MAX_RECHARGED_SHINSU);
  });

  test("clamps counters beyond the fixed circle counts", () => {
    const model = buildShinsuViewModel({ normalAvailable: 12, normalSpent: 0, recharged: 5 });

    expect(model.normal.every((state) => state === "available")).toBe(true);
    expect(model.recharged).toEqual(["available", "available"]);
  });
});

describe("buildRoundViewModel", () => {
  test("reports the round and whose turn it is", () => {
    const model = buildRoundViewModel({ round: 4, currentTurn: "Bob", you: { username: "Alice" } });

    expect(model).toEqual({ round: 4, currentTurn: "Bob", isYourTurn: false });
  });

  test("marks your own turn", () => {
    const model = buildRoundViewModel({ round: 2, currentTurn: "Alice", you: { username: "Alice" } });
    expect(model.isYourTurn).toBe(true);
  });
});

describe("buildGameOverViewModel", () => {
  test("declares victory for the winning player", () => {
    expect(buildGameOverViewModel({ winner: "Alice", reason: "deck exhausted" }, "Alice")).toEqual({
      headline: "Victory",
      winner: "Alice",
      reason: "deck exhausted",
    });
  });

  test("declares defeat for the losing player", () => {
    expect(buildGameOverViewModel({ winner: "Bob", reason: "deck exhausted" }, "Alice")).toEqual({
      headline: "Defeat",
      winner: "Bob",
      reason: "deck exhausted",
    });
  });

  test("is null while the game runs", () => {
    expect(buildGameOverViewModel(null, "Alice")).toBeNull();
  });
});
