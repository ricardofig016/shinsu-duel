import { MAX_STAGE, MIN_STAGE, intToRoman, parseStage, stageName } from "../lib/stage-name.js";

describe("parseStage (evolution stage marker)", () => {
  test("returns null for base-card names without a marker", () => {
    expect(parseStage("Beta")).toBeNull();
    expect(parseStage("Khun Aguero Agnis")).toBeNull();
    expect(parseStage("Twenty-Fifth Baam")).toBeNull();
  });

  test("returns null for trailing words that are not Roman numerals", () => {
    expect(parseStage("Hwaryun Zero")).toBeNull();
    expect(parseStage("Evankhell")).toBeNull();
    expect(parseStage("Mix")).toBeNull();
  });

  test("parses stage II and III", () => {
    expect(parseStage("Beta II")).toEqual({ root: "Beta", stage: 2 });
    expect(parseStage("Beta III")).toEqual({ root: "Beta", stage: 3 });
    expect(parseStage("Test Chain Unit II")).toEqual({ root: "Test Chain Unit", stage: 2 });
  });

  test("parses multi-token roots and long numerals", () => {
    expect(parseStage("Khun Aguero Agnis IV")).toEqual({ root: "Khun Aguero Agnis", stage: 4 });
    expect(parseStage("Zahard XII")).toEqual({ root: "Zahard", stage: 12 });
  });

  test("ignores numerals outside the supported stage window", () => {
    // I is the base stage, so a bare "I" is not a marker.
    expect(parseStage("Zahard I")).toBeNull();
    // Above MAX_STAGE (12) numerals are not markers (e.g. the word "MIX").
    expect(parseStage("MIX")).toBeNull();
  });
});

describe("stageName / intToRoman", () => {
  test("builds stage names from the root", () => {
    expect(stageName("Beta", 2)).toBe("Beta II");
    expect(stageName("Beta", 3)).toBe("Beta III");
    expect(stageName("Test Chain Unit", 10)).toBe("Test Chain Unit X");
  });

  test("round-trips with parseStage", () => {
    for (let stage = MIN_STAGE; stage <= MAX_STAGE; stage++) {
      const name = stageName("Beta", stage);
      expect(parseStage(name)).toEqual({ root: "Beta", stage });
    }
  });

  test("rejects invalid stage numbers", () => {
    expect(() => stageName("Beta", 1)).toThrow();
    expect(() => intToRoman(0)).toThrow();
    expect(() => intToRoman(1.5)).toThrow();
  });

  test("exposes the supported stage window", () => {
    expect(MIN_STAGE).toBe(2);
    expect(MAX_STAGE).toBeGreaterThanOrEqual(3);
  });
});
