import IdFactory, * as idf from "../IdFactory.js";

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
});
