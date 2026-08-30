import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import dslCatalog from "../../schemas/dsl-catalog.json" with { type: "json" };

import {
  checkArtworks,
  compileAll,
  compileCard,
  compileCards,
  compileNode,
  normalizeEffectObject,
  normalizeKeyword,
  normalizeList,
  parseTrigger,
} from "../card-compile.js";

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

  test("normalizeEffectObject normalizes kind and line filter fields", () => {
    const normalized = normalizeEffectObject(
      {
        type: "conditional",
        if: { type: "has_unit", target: { side: "ally", kind: "Shinheuh", line: "Frontline" } },
      },
      "card.passives[0]"
    );

    expect(normalized.if.target.kind).toBe("shinheuh");
    expect(normalized.if.target.line).toBe("frontline");
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

  test("normalizeEffectObject normalizes a card target series code", () => {
    const normalized = normalizeEffectObject(
      { type: "create_card", card: { type: "equipment", series: "Thorn Fragment" } },
      "card.abilities[0]"
    );

    expect(normalized.card.series).toBe("thorn-fragment");
  });

  test("normalizeEffectObject recurses into sequence `targets` and passes link/count through", () => {
    const normalized = normalizeEffectObject(
      {
        type: "sequence",
        targets: { side: "enemy", count: 3, rank: ["Regular", "Ranker"] },
        steps: [
          { type: "deal_damage", amount: 2, target: { link: "sequence" } },
          { type: "give_condition", condition: "burned", target: { link: "sequence", count: 1 } },
        ],
      },
      "card.effects[0]"
    );

    expect(normalized.targets).toEqual({ side: "enemy", count: 3, rank: ["regular", "ranker"] });
    expect(normalized.steps[0].target).toEqual({ link: "sequence" });
    expect(normalized.steps[1].target).toEqual({ link: "sequence", count: 1 });
  });
});

describe("card-compile parseTrigger", () => {
  test("parses an all-equipped evolution trigger", () => {
    expect(parseTrigger("i have Dionysos: Arms, Dionysos: Legs and Dionysos: Wings equipped"))
      .toEqual({ type: "has_all_equipped", cardNames: ["Dionysos: Arms", "Dionysos: Legs", "Dionysos: Wings"] });
  });

  test("parses an activation trigger", () => {
    expect(parseTrigger("activation")).toEqual({ type: "activation" });
  });

  test("still parses a bare round start trigger", () => {
    expect(parseTrigger("round start")).toEqual({ type: "round_start" });
  });

  test("rejects the removed compound round-start-or-activation prose", () => {
    expect(parseTrigger("round start or activation")).toBeNull();
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

  test("compileNode accepts and passes through a triggers array", () => {
    const node = compileNode(
      { type: "deal_damage", amount: 1, target: { side: "enemy" }, triggers: [{ type: "round_start" }, { type: "activation" }] },
      "card.passives[0]"
    );
    expect(node.triggers).toEqual([{ type: "round_start" }, { type: "activation" }]);
  });

  test("compileNode rejects an unknown trigger type inside a triggers array", () => {
    expect(() => compileNode(
      { type: "deal_damage", amount: 1, triggers: [{ type: "round_start" }, { type: "bogus" }] },
      "card.passives[0]"
    )).toThrow('card.passives[0].triggers[1]: unknown trigger type "bogus"');
  });

  test("compileNode rejects a non-array triggers field", () => {
    expect(() => compileNode(
      { type: "deal_damage", amount: 1, triggers: { type: "round_start" } },
      "card.passives[0]"
    )).toThrow("card.passives[0].triggers: expected an array");
  });

  test("compileNode rejects an unknown node type at its own source path", () => {
    expect(() => compileNode({ type: "banana", raw: " peel " }, "card.effects[0]"))
      .toThrow('card.effects[0]: unknown node type "banana"');
  });

  test("compileNode rejects unknown node types nested in sequence steps", () => {
    expect(() => compileNode(
      { type: "sequence", steps: [{ type: "deal_damage", amount: 1 }, { type: "banana", raw: "x" }] },
      "card.effects[0]"
    )).toThrow('card.effects[0].steps[1]: unknown node type "banana"');
  });

  test("compileNode rejects unknown node types in nested single-node fields", () => {
    for (const key of ["effect", "ability", "then", "otherwise"]) {
      expect(() => compileNode(
        { type: "spend_shinsu", amount: 1, [key]: { type: "banana", raw: "x" } },
        "card.effects[0]"
      )).toThrow(`card.effects[0].${key}: unknown node type "banana"`);
    }
  });

  test("compileNode rejects an unknown trigger type on a passive entry", () => {
    expect(() => compileNode(
      { type: "deal_damage", amount: 1, target: { side: "enemy" }, trigger: { type: "banana" } },
      "card.passives[0]"
    )).toThrow('card.passives[0].trigger: unknown trigger type "banana"');
  });

  test("compileNode rejects an unknown predicate type on a conditional", () => {
    expect(() => compileNode(
      { type: "conditional", if: { type: "banana" }, then: { type: "noop" } },
      "card.passives[0]"
    )).toThrow('card.passives[0].if: unknown predicate type "banana"');
  });

  test("compileNode accepts every catalog node type", () => {
    const catalogTypes = [
      ...dslCatalog.structural,
      ...dslCatalog.markers,
      ...dslCatalog.effects,
      ...dslCatalog.modifiers,
      ...dslCatalog.rules,
    ];
    expect(catalogTypes.length).toBeGreaterThan(0);
    for (const type of catalogTypes) {
      expect(() => compileNode({ type, raw: "test" }, "card.effects[0]"))
        .not.toThrow();
    }
  });

  test("structural and marker types compile without needing a registered handler", () => {
    for (const type of [...dslCatalog.structural, ...dslCatalog.markers]) {
      const node = compileNode({ type, raw: "test" }, "card.effects[0]");
      expect(node.type).toBe(type);
    }
  });
});

describe("card-compile compileCard", () => {
  test("compiles a unit with keywords, deckConstraints, and normalized positions", () => {
    const card = compileCard({
      type: "unit",
      name: "Test Unit",
      series: "Thorn Fragment",
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
    expect(card.series).toBe("thorn-fragment");
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

  test("rejects a remove_conditions with mode random/choose but no amount", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Cleanse
cost: 1
deckConstraints: []
effects:
  - type: remove_conditions
    mode: random
    target: { side: ally }
    raw: "remove a random condition from an ally"
`, "utf-8");

    await expect(compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    })).rejects.toThrow("Compiled card data failed");
  });

  test("accepts a remove_conditions with a valid mode and amount", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Cleanse
cost: 1
deckConstraints: []
effects:
  - type: remove_conditions
    mode: random
    amount: 1
    target: { side: ally }
    raw: "remove a random condition from an ally"
`, "utf-8");

    const cards = await compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    });

    expect(cards).toHaveLength(1);
  });

  test("accepts a shared-target sequence with link steps", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Shared
cost: 1
deckConstraints: []
effects:
  - type: sequence
    targets: { side: enemy, count: 3 }
    steps:
      - type: deal_damage
        amount: 2
        target: { link: sequence }
      - type: give_condition
        condition: burned
        target: { link: sequence }
    raw: "deal 2 to 3 enemies and give them Burn"
`, "utf-8");

    const cards = await compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    });

    expect(cards).toHaveLength(1);
    const effect = cards[0].effects[0];
    expect(effect.targets).toEqual({ side: "enemy", count: 3 });
    expect(effect.steps[0].target).toEqual({ link: "sequence" });
    expect(effect.steps[1].target).toEqual({ link: "sequence" });
  });

  test("rejects a link target with a non-sequence link value", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Bad Link Value
cost: 1
deckConstraints: []
effects:
  - type: sequence
    targets: { side: enemy }
    steps:
      - type: deal_damage
        amount: 2
        target: { link: banana }
    raw: "deal 2 to a shared target"
`, "utf-8");

    await expect(compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    })).rejects.toThrow("Compiled card data failed");
  });

  test("rejects `targets` on a non-sequence node", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Bad Targets
cost: 1
deckConstraints: []
effects:
  - type: deal_damage
    amount: 2
    targets: { side: enemy }
    raw: "deal 2 to a shared target"
`, "utf-8");

    await expect(compileAll({
      cardsDirectory: tmpDir,
      outputPath: path.join(tmpDir, "cards.json"),
      runValidate: false,
    })).rejects.toThrow("Compiled card data failed");
  });
});

describe("card-compile compileCards (in-memory)", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "card-compile-memory-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeTestCards() {
    await fs.writeFile(path.join(tmpDir, "b.yml"), `type: skill
name: B Skill
cost: 1
deckConstraints: []
effects:
  - type: deal_damage
    amount: 2
    target: { side: enemy }
    raw: "deal 2 to an enemy"
`, "utf-8");
    await fs.writeFile(path.join(tmpDir, "a.yml"), `type: unit
name: A Unit
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
deckConstraints: []
`, "utf-8");
  }

  test("returns the same keyed artifact that compileAll writes, without touching files", async () => {
    await writeTestCards();

    const { output, cards } = await compileCards({ cardsDirectory: tmpDir });
    expect(cards).toHaveLength(2);
    expect(Object.keys(output)).toHaveLength(2);

    const outputPath = path.join(tmpDir, "cards.json");
    await compileAll({ cardsDirectory: tmpDir, outputPath, runValidate: false });
    const written = JSON.parse(await fs.readFile(outputPath, "utf-8"));

    expect(output).toEqual(written);
  });

  test("compiles deterministically with stable name-sorted cardIds", async () => {
    await writeTestCards();

    const first = await compileCards({ cardsDirectory: tmpDir });
    const second = await compileCards({ cardsDirectory: tmpDir });

    expect(first.output).toEqual(second.output);
    expect(first.output["0"].name).toBe("A Unit");
    expect(first.output["1"].name).toBe("B Skill");
    for (const [key, card] of Object.entries(first.output)) {
      expect(String(card.cardId)).toBe(key);
    }
  });

  test("fails on duplicate card names instead of shadowing an artifact entry", async () => {
    await writeTestCards();
    await fs.writeFile(path.join(tmpDir, "a2.yml"), `type: skill
name: A Unit
cost: 1
deckConstraints: []
effects: []
`, "utf-8");

    await expect(compileCards({ cardsDirectory: tmpDir }))
      .rejects.toThrow("Duplicate card names: A Unit");
  });

  test("fails on an unknown node type before any file is written", async () => {
    await fs.writeFile(path.join(tmpDir, "skill.yml"), `type: skill
name: Test Unknown Type
cost: 1
deckConstraints: []
effects:
  - type: sequence
    steps:
      - type: banana
        raw: "mystery step"
    raw: "mystery"
`, "utf-8");

    await expect(compileCards({ cardsDirectory: tmpDir }))
      .rejects.toThrow('effects[0].steps[0]: unknown node type "banana"');
  });
});

describe("card-compile artwork resolution", () => {
  let tmpDir;
  let artDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "card-compile-art-"));
    artDir = path.join(tmpDir, "artworks");
    await fs.mkdir(artDir);
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeUnit(name) {
    await fs.writeFile(path.join(tmpDir, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.yml`), `type: unit
name: ${name}
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
deckConstraints: []
`, "utf-8");
  }

  test("stamps artworkPath only for cards whose slug exists in the artworks directory", async () => {
    await writeUnit("A Unit");
    await writeUnit("B Skill");
    await fs.writeFile(path.join(artDir, "a_unit.png"), "png", "utf-8");

    const { output, cards } = await compileCards({
      cardsDirectory: tmpDir,
      artworksDirectory: artDir,
    });

    const withArt = cards.find((card) => card.name === "A Unit");
    const withoutArt = cards.find((card) => card.name === "B Skill");
    expect(withArt.artworkPath).toBe("/assets/images/artworks/a_unit.png");
    expect(withoutArt).not.toHaveProperty("artworkPath");
    // The stamped field must survive schema validation inside compileCards
    // (a validation failure would have thrown above) and reach the artifact.
    expect(output[String(withArt.cardId)].artworkPath).toBe("/assets/images/artworks/a_unit.png");
  });

  test("checkArtworks reports missing card slugs and orphan files, ignoring raw/ and non-png files", async () => {
    await writeUnit("A Unit");
    await writeUnit("B Skill");
    await fs.writeFile(path.join(artDir, "a_unit.png"), "png", "utf-8");
    await fs.writeFile(path.join(artDir, "orphan.png"), "png", "utf-8");
    await fs.writeFile(path.join(artDir, "README.md"), "docs", "utf-8");
    await fs.mkdir(path.join(artDir, "raw"));
    await fs.writeFile(path.join(artDir, "raw", "source.png"), "png", "utf-8");

    const { cards } = await compileCards({
      cardsDirectory: tmpDir,
      artworksDirectory: artDir,
    });
    const { missing, orphans } = await checkArtworks(cards, artDir);

    expect(missing).toEqual(["b_skill"]);
    expect(orphans).toEqual(["orphan"]);
  });

  test("models a missing artworks directory as no artwork at all", async () => {
    await writeUnit("A Unit");
    const absentDir = path.join(tmpDir, "does-not-exist");

    const { cards } = await compileCards({
      cardsDirectory: tmpDir,
      artworksDirectory: absentDir,
    });
    expect(cards.every((card) => card.artworkPath === undefined)).toBe(true);

    const { missing, orphans } = await checkArtworks(cards, absentDir);
    expect(missing).toEqual(["a_unit"]);
    expect(orphans).toEqual([]);
  });
});
