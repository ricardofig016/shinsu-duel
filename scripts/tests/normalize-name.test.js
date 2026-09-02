import { normalizeName } from "../lib/normalize-name.js";

describe("normalizeName (canonical card slug)", () => {
  test("lowercases and replaces spaces with underscores", () => {
    expect(normalizeName("Ha Yuri Zahard")).toBe("ha_yuri_zahard");
  });

  test("collapses runs of non-alphanumerics into a single underscore", () => {
    // These three names pin the artwork contract: "<slug>.png" on disk must
    // equal "<slug>.yml" for the same card.
    expect(normalizeName("Twenty-Fifth Baam")).toBe("twenty_fifth_baam");
    expect(normalizeName("Karaka II")).toBe("karaka_ii");
    expect(normalizeName("Narumada - Ignited")).toBe("narumada_ignited");
  });

  test("folds punctuation and apostrophes into separators", () => {
    expect(normalizeName("Khun's Dagger")).toBe("khun_s_dagger");
  });

  test("trims leading and trailing separators", () => {
    expect(normalizeName("  Edahn! ")).toBe("edahn");
    expect(normalizeName("--White--")).toBe("white");
  });

  test("keeps digits", () => {
    expect(normalizeName("Hell Joe 2")).toBe("hell_joe_2");
  });
});
