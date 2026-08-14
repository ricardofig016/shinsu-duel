import { jest } from "@jest/globals";
import IdFactory, * as idf from "../../IdFactory.js";

describe("IdFactory", () => {
  beforeEach(() => {
    IdFactory.resetAll();
  });

  test("unitSource follows convention", () => {
    expect(idf.unitSource(5)).toBe("Unit#5");
  });

  test("equipSource follows convention", () => {
    expect(idf.equipSource(17)).toBe("Equip#17");
  });

  test("cardInstance produces unique sequential IDs", () => {
    const id1 = idf.cardInstance(1);
    const id2 = idf.cardInstance(1);
    expect(id1).toBe("Card#1#1");
    expect(id2).toBe("Card#1#2");
    expect(id1).not.toBe(id2);
  });

  test("unitInstance produces unique sequential IDs", () => {
    const id1 = idf.unitInstance(5);
    const id2 = idf.unitInstance(5);
    expect(id1).toBe("Unit#5#1");
    expect(id2).toBe("Unit#5#2");
  });

  test("abilitySource follows convention", () => {
    expect(idf.abilitySource("Unit#5#1", 0)).toBe("Ability#Unit#5#1#0");
  });

  test("passiveSource follows convention", () => {
    expect(idf.passiveSource("Unit#5#1", 2)).toBe("Passive#Unit#5#1#2");
  });

  test("systemSource returns System", () => {
    expect(idf.systemSource()).toBe("System");
  });

  test("resetAll restarts counters", () => {
    idf.cardInstance(1); // Card#1#1
    idf.cardInstance(2); // Card#2#2
    IdFactory.resetAll();
    expect(idf.cardInstance(3)).toBe("Card#3#1");
  });

  test("skillSource follows convention", () => {
    expect(idf.skillSource(9)).toBe("Skill#9");
  });

  test("landmarkSource follows convention", () => {
    expect(idf.landmarkSource("Unit#5#1")).toBe("Landmark#Unit#5#1");
  });

  test("modifierId produces unique sequential IDs", () => {
    expect(idf.modifierId()).toBe("mod_1");
    expect(idf.modifierId()).toBe("mod_2");
  });

  test("decisionId produces unique sequential IDs", () => {
    expect(idf.decisionId()).toBe("decision#1");
    expect(idf.decisionId()).toBe("decision#2");
  });

  test("grantedAbilityCode formats source and ability type", () => {
    expect(idf.grantedAbilityCode("Equip#17", { type: "deal_damage" })).toBe("granted:Equip#17:deal_damage");
    expect(idf.grantedAbilityCode("Equip#17", {})).toBe("granted:Equip#17:custom");
    expect(idf.grantedAbilityCode("Equip#17", null)).toBe("granted:Equip#17:custom");
  });

  test("getCounters and setCounters round-trip", () => {
    idf.cardInstance(1);
    idf.unitInstance(2);
    idf.modifierId();
    idf.decisionId();
    const snapshot = idf.getCounters();
    expect(snapshot).toEqual({
      cardInstanceSeq: 1,
      unitInstanceSeq: 1,
      modifierSeq: 1,
      decisionSeq: 1,
    });

    IdFactory.resetAll();
    idf.setCounters(snapshot);
    expect(idf.getCounters()).toEqual(snapshot);
  });

  test("setCounters with partial object fills missing with 0", () => {
    idf.setCounters({ cardInstanceSeq: 5 });
    expect(idf.getCounters()).toEqual({
      cardInstanceSeq: 5,
      unitInstanceSeq: 0,
      modifierSeq: 0,
      decisionSeq: 0,
    });
  });

  test("setCounters with null is a no-op", () => {
    idf.cardInstance(1);
    const before = idf.getCounters();
    idf.setCounters(null);
    expect(idf.getCounters()).toEqual(before);
  });

  test("registerModifierReset wires the resetAll hook", () => {
    const fn = jest.fn();
    idf.registerModifierReset(fn);
    IdFactory.resetAll();
    expect(fn).toHaveBeenCalled();
  });
});
