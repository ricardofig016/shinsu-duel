import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  compileAll,
  compileCard,
  compileNode,
  normalizeEffectObject,
  normalizeKeyword,
  normalizeList,
  parseTrigger,
} from "./card-compile.js";

describe("card-compile normalization helpers", () => {
  test("normalizeKeyword maps strings and { code, raw } objects to code form", () => {
    expect(normalizeKeyword("Jeonsul Baang")).toEqual({ code: "jeonsul-baang" });
    expect(normalizeKeyword({ code: "Jeonsul Baang", raw: "i am a Jeonsul Baang" }))
      .toEqual({ code: "jeonsul-baang", raw: "i am a Jeonsul Baang" });
  });

  test("normalizeKeyword rejects empty strings and invalid shapes", () => {
    expect(() => normalizeKeyword("   ")).toThrow("empty keyword");
    expect(() => normalizeKeyword({ raw: "no code" })).toThrow("expected a string or { code, raw }");
    expect(() => normalizeKeyword(42)).toThrow("expected a string or { code, raw }");
  });

  test("normalizeList maps each array element or a single value", () => {
    const upper = (s) => s.toUpperCase();
    expect(normalizeList("a", upper)).toBe("A");
    expect(normalizeList(["a", "b"], upper)).toEqual(["A", "B"]);
  });

  test("normalizeEffectObject normalizes code-bearing fields and recurses", () => {
    const normalized = normalizeEffectObject(
      {
        type: "deal_damage",
        position: "Wave Controller",
        condition: "Burned",
        trait: "Strong",
        steps: [
          { type: "heal", affiliation: ["Team Chang", "Fug"], rank: ["Regular", "Ranker"] },
        ],
      },
      "card.effects[0]"
    );

    expect(normalized.position).toBe("wave-controller");
    expect(normalized.condition).toBe("burned");
    expect(normalized.trait).toBe("strong");
    expect(normalized.steps[0].affiliation).toEqual(["team-chang", "fug"]);
    expect(normalized.steps[0].rank).toEqual(["regular", "ranker"]);
  });

  test("normalizeEffectObject rejects non-object nodes with a context path", () => {
    expect(() => normalizeEffectObject("deal 3", "card.effects[0]"))
      .toThrow("card.effects[0]: expected an object");
  });

  test("normalizeEffectObject expands the shinheuh position family in filters", () => {
    const normalized = normalizeEffectObject(
      {
        type: "conditional",
        if: { type: "has_unit", target: { side: "ally", position: "shinheuh" } },
      },
      "card.passives[0]"
    );

    expect(normalized.if.target.position).toEqual(["frontline-shinheuh", "backline-shinheuh"]);
  });

  test("normalizeEffectObject leaves a single concrete position filter unchanged", () => {
    const normalized = normalizeEffectObject(
      { type: "deal_damage", target: { side: "enemy", position: "wave controller" } },
      "card.effects[0]"
    );

    expect(normalized.target.position).toBe("wave-controller");
  });

  test("normalizeEffectObject normalizes traitNot and preserves lowest_hp", () => {
    const normalized = normalizeEffectObject(
      { type: "grant_trait", trait: "immune", target: { side: "ally", traitNot: "Immune", lowest_hp: true } },
      "card.passives[0]"
    );

    expect(normalized.target.traitNot).toBe("immune");
    expect(normalized.target.lowest_hp).toBe(true);
  });

  test("normalizeEffectObject passes a structured disarm `to` object through unchanged", () => {
    const normalized = normalizeEffectObject(
      { type: "disarm", target: { side: "enemy" }, to: { zone: "discard", owner: "you" } },
      "card.effects[0]"
    );

    expect(normalized.to).toEqual({ zone: "discard", owner: "you" });
  });
});

describe("card-compile parseTrigger", () => {
  test("parses an all-equipped evolution trigger", () => {
    expect(parseTrigger("i have Dionysos: Arms, Dionysos: Legs and Dionysos: Wings equipped"))
      .toEqual({ type: "has_all_equipped", cardNames: ["Dionysos: Arms", "Dionysos: Legs", "Dionysos: Wings"] });
  });
});

describe("card-compile structured-node validation", () => {
  test("compileNode rejects a missing/empty type", () => {
    expect(() => compileNode({ amount: 1 }, "card.effects[0]"))
      .toThrow('card.effects[0]: missing non-empty "type"');
    expect(() => compileNode("not an object", "card.effects[0]"))
      .toThrow("card.effects[0]: expected a structured effect object");
  });

  test("compileNode accepts and normalizes a valid structured node", () => {
    const node = compileNode({ type: "deal_damage", amount: 2, target: { side: "enemy" } }, "card.effects[0]");
    expect(node.type).toBe("deal_damage");
    expect(node.target).toEqual({ side: "enemy" });
  });
});

describe("card-compile compileCard", () => {
  test("compiles a unit with keywords, deckConstraints, and normalized positions", () => {
    const card = compileCard({
      type: "unit",
      name: "Test Unit",
      cost: 2,
      hp: 5,
      rank: "regular",
      positions: ["Wave Controller"],
      traits: ["Strong 2"],
      attributes: ["Hwayeomsa"],
      affiliations: ["Team Baam"],
      abilities: [{ type: "deal_damage", amount: 1, target: { side: "enemy" } }],
      passives: [],
      keywords: ["Jeonsul Baang"],
      deckConstraints: [{ type: "unreachable", raw: "i am Unreachable" }],
    }, []);

    expect(card.type).toBe("unit");
    expect(card.keywords).toEqual([{ code: "jeonsul-baang" }]);
    expect(card.deckConstraints).toEqual([{ type: "unreachable", raw: "i am Unreachable" }]);
    expect(card.positions).toEqual(["wave-controller"]);
    expect(card.attributes).toEqual(["hwayeomsa"]);
    expect(card.abilities[0].type).toBe("deal_damage");
  });
});

describe("card-compile compileAll (fixture)", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "card-compile-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  test("compiles structured YAML into a zero-custom/zero-handler artifact", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Skill
cost: 1
deckConstraints: []
effects:
  - type: deal_damage
    amount: 2
    target: { side: enemy }
    raw: "deal 2 to an enemy"
`, "utf-8");

    await fs.writeFile(path.join(tmpDir, "unit.yml"), `type: unit
name: Test Unit
cost: 2
hp: 5
rank: regular
positions:
  - fisherman
traits: []
attributes: []
affiliations: []
abilities: []
passives: []
keywords:
  - Jeonsul Baang
deckConstraints:
  - type: unreachable
    raw: "i am Unreachable"
`, "utf-8");

    const outputPath = path.join(tmpDir, "cards.json");
    const cards = await compileAll({
      cardsDirectory: tmpDir,
      outputPath,
      runValidate: false,
    });

    expect(cards).toHaveLength(2);
    const serialized = JSON.stringify(cards);
    expect(serialized).not.toContain('"custom"');
    expect(serialized).not.toContain('"handler"');

    const written = JSON.parse(await fs.readFile(outputPath, "utf-8"));
    expect(Object.keys(written)).toHaveLength(2);
    const unit = Object.values(written).find((card) => card.name === "Test Unit");
    expect(unit.deckConstraints[0]).toEqual({ type: "unreachable", raw: "i am Unreachable" });
    expect(unit.keywords).toEqual([{ code: "jeonsul-baang" }]);
  });

  test("fails fast on a prose effect instead of guessing meaning", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Skill
cost: 1
deckConstraints: []
effects:
  - "deal 2 to an enemy"
`, "utf-8");

    await expect(compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    })).rejects.toThrow("expected a structured effect object");
  });

  test("rejects a trigger-less passive whose branch is not revoke-safe", async () => {
    await fs.writeFile(path.join(tmpDir, "unit.yml"), `type: unit
name: Test Unit
cost: 2
hp: 5
rank: regular
positions:
  - fisherman
traits: []
attributes: []
affiliations: []
abilities: []
passives:
  - type: deal_damage
    amount: 1
    target: { side: enemy }
    raw: "always deal 1"
`, "utf-8");

    await expect(compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    })).rejects.toThrow("Compiled card data failed");
  });

  test("accepts a trigger-less conditional passive with revoke-safe branches", async () => {
    await fs.writeFile(path.join(tmpDir, "unit.yml"), `type: unit
name: Test Unit
cost: 2
hp: 5
rank: regular
positions:
  - fisherman
traits: []
attributes: []
affiliations: []
abilities: []
passives:
  - type: conditional
    if:
      type: alone_on_line
      line: frontline
    then:
      type: sequence
      steps:
        - type: grant_trait
          trait: strong
          amount: 1
          target: { side: self }
    raw: "while alone, strong 1"
`, "utf-8");

    const cards = await compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    });

    expect(cards).toHaveLength(1);
  });
});
