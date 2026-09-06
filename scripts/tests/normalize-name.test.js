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

  test("drops apostrophes instead of turning them into separators", () => {
    // These names pin the artwork contract: the on-disk possessive files
    // ("woons_hammer.png", "enryus_thorn.png", "karakas_armor_suit.png") must
    // equal "<slug>.png" for the same card, and "<slug>.yml" for its source.
    expect(normalizeName("Woon's Hammer")).toBe("woons_hammer");
    expect(normalizeName("Enryu's Thorn")).toBe("enryus_thorn");
    expect(normalizeName("Karaka's Armor Suit")).toBe("karakas_armor_suit");
    expect(normalizeName("Khun's Dagger")).toBe("khuns_dagger");
    expect(normalizeName("Khun’s Dagger")).toBe("khuns_dagger");
  });

  test("trims leading and trailing separators", () => {
    expect(normalizeName("  Edahn! ")).toBe("edahn");
    expect(normalizeName("--White--")).toBe("white");
  });

  test("keeps digits", () => {
    expect(normalizeName("Hell Joe 2")).toBe("hell_joe_2");
  });
});
