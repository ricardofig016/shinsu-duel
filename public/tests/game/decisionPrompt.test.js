import {
  buildDecisionPromptViewModel,
  canSubmitDecision,
} from "../../game/viewModels.js";
import { buildDecision } from "../../game/actions.js";

const targetDecision = {
  decisionId: "decision-1",
  type: "target_selection",
  candidates: [
    { id: "unit-1", name: "Test Scout", hp: 3 },
    { id: "unit-2", name: "Test Shinheuh", hp: 5 },
  ],
  minChoices: 1,
  maxChoices: 1,
  lockedIds: [],
};

const cardDecision = {
  decisionId: "decision-2",
  type: "card_selection",
  candidates: [
    { id: 101, name: "Test Scout", hp: null },
    { id: 102, name: "Test Skill", hp: null },
    { id: 103, name: "Test Equipment", hp: null },
  ],
  minChoices: 1,
  maxChoices: 2,
  lockedIds: [103],
};

describe("buildDecisionPromptViewModel", () => {
  test("is null when the player has no pending decision", () => {
    expect(buildDecisionPromptViewModel(null)).toBeNull();
  });

  test("renders a target selection with its prompt title", () => {
    const prompt = buildDecisionPromptViewModel(targetDecision);

    expect(prompt).toEqual({
      decisionId: "decision-1",
      type: "target_selection",
      title: "Choose a target",
      candidates: [
        { id: "unit-1", name: "Test Scout", hp: 3 },
        { id: "unit-2", name: "Test Shinheuh", hp: 5 },
      ],
      minChoices: 1,
      maxChoices: 1,
      lockedIds: [],
    });
  });

  test("renders a card selection with locked candidates", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);

    expect(prompt.title).toBe("Choose cards");
    expect(prompt.minChoices).toBe(1);
    expect(prompt.maxChoices).toBe(2);
    expect(prompt.lockedIds).toEqual([103]);
    expect(prompt.candidates).toHaveLength(3);
  });

  test("defaults the choice range and title for unknown types", () => {
    const prompt = buildDecisionPromptViewModel({
      decisionId: "decision-3",
      type: "mystery",
      candidates: [{ id: 9, name: "Anything" }],
    });

    expect(prompt.title).toBe("Choose");
    expect(prompt.minChoices).toBe(1);
    expect(prompt.maxChoices).toBe(1);
    expect(prompt.candidates[0]).toEqual({ id: 9, name: "Anything", hp: null });
  });
});

describe("canSubmitDecision", () => {
  test("accepts a selection that meets the range with candidate ids", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);
    expect(canSubmitDecision(prompt, [])).toBe(true); // locked 103 alone satisfies min 1
    expect(canSubmitDecision(prompt, [101])).toBe(true); // locked + 1 more reaches max 2
  });

  test("rejects selections outside the range or with unknown ids", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);
    expect(canSubmitDecision(prompt, [999])).toBe(false);
    expect(canSubmitDecision(prompt, [101, 102])).toBe(false); // locked + 2 exceeds max 2
  });

  test("counts locked candidates but not duplicated picks", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);
    expect(canSubmitDecision(prompt, [103])).toBe(true); // duplicate of the locked pick
    expect(canSubmitDecision(prompt, [102, 103])).toBe(true);
  });

  test("rejects a single-choice decision with nothing selected", () => {
    const prompt = buildDecisionPromptViewModel(targetDecision);
    expect(canSubmitDecision(prompt, [])).toBe(false);
    expect(canSubmitDecision(prompt, ["unit-2"])).toBe(true);
  });

  test("rejects without a prompt", () => {
    expect(canSubmitDecision(null, ["unit-1"])).toBe(false);
  });
});

describe("buildDecision", () => {
  test("builds the exact decision payload", () => {
    expect(buildDecision("decision-1", ["unit-1"])).toEqual({
      decisionId: "decision-1",
      choices: ["unit-1"],
    });
  });

  test("copies the choice list", () => {
    const choices = [1, 2];
    const payload = buildDecision("decision-2", choices);
    choices.push(3);
    expect(payload.choices).toEqual([1, 2]);
  });

  test("rejects malformed decisions", () => {
    expect(() => buildDecision("", [1])).toThrow(TypeError);
    expect(() => buildDecision("decision-1", "nope")).toThrow(TypeError);
  });
});
