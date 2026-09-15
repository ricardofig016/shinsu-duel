import SeededRng from "../../../game/utils/SeededRng.js";
import DrunkPlaystyle from "../../playstyles/DrunkPlaystyle.js";

/** A deployed unit as it appears in a field view. */
const unit = (name, attributes = []) => ({
  card: { name, attributes: Object.fromEntries(attributes.map((code) => [code, {}])) },
});

/** A hand card as it appears in the seat view. */
const handUnit = (name, { cost = 1, kind = "standard", positions = ["scout"], line = "frontline", type = "unit" } = {}) => ({
  type,
  kind,
  name,
  cost,
  effectiveCost: cost,
  positions: Object.fromEntries(positions.map((code) => [code, { line }])),
});

/** A minimal seat view with the fields the playstyle reads. */
const view = ({ hand = [], shinsu = 5, frontline = [], backline = [] } = {}) => ({
  you: {
    hand,
    shinsu: { normalAvailable: shinsu, recharged: 0 },
    field: { frontline, backline },
  },
});

const PASS = { type: "pass-turn-action", data: {} };
const FIRE_CHARGE = { type: "generate-fire-charge-action", data: {} };

const decision = (overrides = {}) => ({
  decisionId: "d1",
  type: "target_selection",
  candidates: [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }],
  minChoices: 1,
  maxChoices: 1,
  lockedIds: [],
  ...overrides,
});

describe("DrunkPlaystyle", () => {
  const playstyle = new DrunkPlaystyle();

  test("is deterministic for a fixed seed and view", () => {
    const view1 = view({ hand: [handUnit("Grinder", { positions: ["scout", "lightbearer"] })], shinsu: 3 });
    expect(playstyle.decideTurn(view1, new SeededRng(1))).toEqual(playstyle.decideTurn(view1, new SeededRng(1)));
  });

  test("picks only moves the view can verify, over many seeds", () => {
    const scoutView = view({
      hand: [handUnit("Grinder", { positions: ["scout", "lightbearer"] })],
      shinsu: 3,
      frontline: [unit("Hwayeomsa Scout", ["hwayeomsa"])],
    });
    const expected = new Set([
      JSON.stringify(PASS),
      JSON.stringify(FIRE_CHARGE),
      JSON.stringify({ type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "scout" } }),
      JSON.stringify({ type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "lightbearer" } }),
    ]);

    const seen = new Set();
    for (let seed = 0; seed < 40; seed++) {
      const action = playstyle.decideTurn(scoutView, new SeededRng(seed));
      const key = JSON.stringify(action);
      expect(expected.has(key)).toBe(true);
      seen.add(key);
    }
    // A uniform pick over four candidates must reach more than one of them.
    expect(seen.size).toBeGreaterThan(1);
  });

  test("passes when the hand is empty and no fire charge is available", () => {
    for (let seed = 0; seed < 10; seed++) {
      expect(playstyle.decideTurn(view(), new SeededRng(seed))).toEqual(PASS);
    }
  });

  test("passes on a missing or malformed view instead of crashing", () => {
    for (const brokenView of [null, undefined, {}, { you: null }]) {
      for (let seed = 0; seed < 5; seed++) {
        expect(playstyle.decideTurn(brokenView, new SeededRng(seed))).toEqual(PASS);
      }
    }
  });

  test("excludes a standard unit with no printed positions", () => {
    const positionlessView = view({ hand: [handUnit("Mystery Unit", { positions: [] })], shinsu: 9 });
    for (let seed = 0; seed < 10; seed++) {
      expect(playstyle.decideTurn(positionlessView, new SeededRng(seed))).toEqual(PASS);
    }
  });

  test("falls back to the printed cost when a card has no effective cost", () => {
    const card = { ...handUnit("Grinder", { positions: ["scout"] }) };
    delete card.effectiveCost;
    const view1 = view({ hand: [card], shinsu: 3 });
    const seen = new Set();
    for (let seed = 0; seed < 20; seed++) {
      seen.add(JSON.stringify(playstyle.decideTurn(view1, new SeededRng(seed))));
    }
    expect(seen.has(JSON.stringify({ type: "deploy-unit-action", data: { handId: 0, placedPositionCode: "scout" } }))).toBe(true);
  });

  test("excludes unaffordable deploys", () => {
    const poorView = view({ hand: [handUnit("Chad", { cost: 10 })], shinsu: 2 });
    for (let seed = 0; seed < 20; seed++) {
      expect(playstyle.decideTurn(poorView, new SeededRng(seed))).toEqual(PASS);
    }
  });

  test("excludes a card whose name is already deployed", () => {
    const doubledView = view({
      hand: [handUnit("Grinder")],
      frontline: [unit("Grinder"), unit("Hwayeomsa Scout", ["hwayeomsa"])],
      shinsu: 5,
    });
    const allowed = new Set([JSON.stringify(PASS), JSON.stringify(FIRE_CHARGE)]);
    for (let seed = 0; seed < 20; seed++) {
      expect(allowed.has(JSON.stringify(playstyle.decideTurn(doubledView, new SeededRng(seed))))).toBe(true);
    }
  });

  test("excludes non-standard units and non-unit cards", () => {
    const oddHandView = view({
      hand: [handUnit("Floor of Death", { kind: "landmark" }), handUnit("Skill Card", { type: "skill" })],
      shinsu: 9,
    });
    for (let seed = 0; seed < 20; seed++) {
      expect(playstyle.decideTurn(oddHandView, new SeededRng(seed))).toEqual(PASS);
    }
  });

  test("excludes deploys into a full line", () => {
    const crowdedView = view({
      hand: [handUnit("Grinder", { positions: ["scout"] })],
      shinsu: 5,
      frontline: [unit("A"), unit("B"), unit("C"), unit("D"), unit("E")],
    });
    for (let seed = 0; seed < 20; seed++) {
      expect(playstyle.decideTurn(crowdedView, new SeededRng(seed))).toEqual(PASS);
    }
  });

  test("generates a fire charge only with a Hwayeomsa unit and shinsu to spend", () => {
    const noUnitView = view({ shinsu: 5 });
    for (let seed = 0; seed < 30; seed++) {
      expect(playstyle.decideTurn(noUnitView, new SeededRng(seed))).toEqual(PASS);
    }

    const noShinsuView = view({ hand: [], shinsu: 0, frontline: [unit("Hwayeomsa Scout", ["hwayeomsa"])] });
    for (let seed = 0; seed < 30; seed++) {
      expect(playstyle.decideTurn(noShinsuView, new SeededRng(seed))).toEqual(PASS);
    }

    const readyView = view({ shinsu: 1, frontline: [unit("Hwayeomsa Scout", ["hwayeomsa"])] });
    const seen = new Set();
    for (let seed = 0; seed < 30; seed++) {
      seen.add(JSON.stringify(playstyle.decideTurn(readyView, new SeededRng(seed))));
    }
    expect(seen.has(JSON.stringify(FIRE_CHARGE))).toBe(true);
  });

  describe("resolveDecision", () => {
    test("is deterministic for a fixed seed", () => {
      const d = decision({ minChoices: 2, maxChoices: 3 });
      expect(playstyle.resolveDecision(d, new SeededRng(3))).toEqual(playstyle.resolveDecision(d, new SeededRng(3)));
    });

    test("stays within the valid range and the free candidates", () => {
      const d = decision({ minChoices: 1, maxChoices: 3, lockedIds: ["a"] });
      const free = ["b", "c", "d"];
      for (let seed = 0; seed < 40; seed++) {
        const { choices } = playstyle.resolveDecision(d, new SeededRng(seed));
        expect(choices.length).toBeGreaterThanOrEqual(1);
        expect(choices.length).toBeLessThanOrEqual(3);
        for (const choice of choices) expect(free).toContain(choice);
        expect(new Set(choices).size).toBe(choices.length);
      }
    });

    test("picks exactly minChoices when the range is fixed", () => {
      const d = decision({ minChoices: 2, maxChoices: 2 });
      for (let seed = 0; seed < 10; seed++) {
        expect(playstyle.resolveDecision(d, new SeededRng(seed)).choices).toHaveLength(2);
      }
    });

    test("caps the count at the pool size instead of submitting an unresolvable decision", () => {
      const d = decision({ minChoices: 2, maxChoices: 2, candidates: [{ id: "only" }] });
      expect(playstyle.resolveDecision(d, new SeededRng(1))).toEqual({ decisionId: "d1", choices: ["only"] });
    });
  });
});
