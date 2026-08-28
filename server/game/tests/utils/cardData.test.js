import { findCardsByName, findCardsBySeries, findCardsByKeyword, toCardTargetView } from "../../utils/cardData.js";

describe("cardData helpers", () => {
  const cards = {
    0: { cardId: 0, type: "skill", name: "Incinerate I", series: "incinerate", cost: 0 },
    1: { cardId: 1, type: "skill", name: "Incinerate II", series: "incinerate", cost: 0 },
    2: { cardId: 2, type: "equipment", name: "First Thorn Fragment", series: "thorn-fragment", cost: 1 },
    3: { cardId: 3, type: "equipment", name: "Second Thorn Fragment", series: "thorn-fragment", cost: 1 },
    4: { cardId: 4, type: "skill", name: "Fire Core", cost: 0 },
    5: { cardId: 5, type: "skill", name: "Thunder Baang", keywords: [{ code: "jeonsul-baang" }], cost: 1 },
    6: { cardId: 6, type: "skill", name: "Lightning Baang", keywords: [{ code: "jeonsul-baang", raw: "i am a Jeonsul Baang" }], cost: 1 },
    7: { cardId: 7, type: "unit", name: "Baang Speaker", keywords: [{ code: "jeonsul-baang" }], cost: 2 },
  };

  test("findCardsByName matches exact name (case-insensitive) with optional type filter", () => {
    expect(findCardsByName(cards, "Fire Core").map((c) => c.name)).toEqual(["Fire Core"]);
    expect(findCardsByName(cards, "fire core").map((c) => c.name)).toEqual(["Fire Core"]);
    expect(findCardsByName(cards, "Fire Core", "equipment")).toEqual([]);
    expect(findCardsByName(cards, "Nonexistent")).toEqual([]);
  });

  test("findCardsBySeries matches exact series code (case-insensitive) with optional type filter", () => {
    expect(findCardsBySeries(cards, "incinerate").map((c) => c.name)).toEqual(["Incinerate I", "Incinerate II"]);
    expect(findCardsBySeries(cards, "THORN-FRAGMENT", "equipment").map((c) => c.name)).toEqual([
      "First Thorn Fragment",
      "Second Thorn Fragment",
    ]);
    expect(findCardsBySeries(cards, "incinerate", "equipment")).toEqual([]);
    expect(findCardsBySeries(cards, "nonexistent")).toEqual([]);
  });

  test("findCardsBySeries does not partial-match series codes", () => {
    expect(findCardsBySeries(cards, "incin")).toEqual([]);
    expect(findCardsBySeries(cards, "thorn")).toEqual([]);
  });

  test("findCardsByKeyword matches exact keyword code (case-insensitive) with optional type filter", () => {
    expect(findCardsByKeyword(cards, "jeonsul-baang").map((c) => c.name).sort()).toEqual([
      "Baang Speaker",
      "Lightning Baang",
      "Thunder Baang",
    ]);
    expect(findCardsByKeyword(cards, "JEONSUL-BAANG", "skill").map((c) => c.name).sort()).toEqual([
      "Lightning Baang",
      "Thunder Baang",
    ]);
    expect(findCardsByKeyword(cards, "jeonsul-baang", "unit").map((c) => c.name)).toEqual([
      "Baang Speaker",
    ]);
  });

  test("findCardsByKeyword does not partial-match keyword codes and skips cards without keywords", () => {
    expect(findCardsByKeyword(cards, "jeonsul")).toEqual([]);
    expect(findCardsByKeyword(cards, "baang")).toEqual([]);
    expect(findCardsByKeyword(cards, "jeonsul-baang").some((c) => c.name === "Fire Core")).toBe(false);
  });

  test("returns empty for invalid input", () => {
    expect(findCardsByName(null, "X")).toEqual([]);
    expect(findCardsBySeries(undefined, "X")).toEqual([]);
    expect(findCardsBySeries(cards, "")).toEqual([]);
    expect(findCardsByKeyword(null, "jeonsul-baang")).toEqual([]);
    expect(findCardsByKeyword(undefined, "jeonsul-baang")).toEqual([]);
    expect(findCardsByKeyword(cards, "")).toEqual([]);
    expect(findCardsByKeyword(cards, "jeonsul-baang", "equipment")).toEqual([]);
  });

  test("toCardTargetView normalizes series and dictionary/array codes", () => {
    const instance = {
      id: "card#1",
      cardId: 1,
      name: "Incinerate II",
      series: "incinerate",
      type: "skill",
      cost: 0,
      rank: null,
      positions: { "wave-controller": {} },
      affiliations: { fug: {} },
      attributes: ["hwayeomsa"],
    };
    expect(toCardTargetView(instance)).toEqual({
      id: "card#1",
      cardId: 1,
      name: "Incinerate II",
      series: "incinerate",
      type: "skill",
      kind: "standard",
      line: null,
      cost: 0,
      rank: null,
      positions: ["wave-controller"],
      affiliations: ["fug"],
      attributes: ["hwayeomsa"],
    });
    expect(toCardTargetView(null)).toBeNull();
  });
});
