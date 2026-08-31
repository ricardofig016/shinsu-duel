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

// Locked decisions carry only the free candidates; locked ids are
// engine-committed picks outside the candidate list (mandatory Taunts).
const lockedDecision = {
  decisionId: "decision-2",
  type: "target_selection",
  candidates: [
    { id: "unit-3", name: "Free Ally", hp: 2 },
    { id: "unit-4", name: "Free Enemy", hp: 4 },
  ],
  minChoices: 1,
  maxChoices: 1,
  lockedIds: ["unit-taunt"],
};

const cardDecision = {
  decisionId: "decision-3",
  type: "card_selection",
  candidates: [
    { id: 101, name: "Test Scout", hp: null },
    { id: 102, name: "Test Skill", hp: null },
  ],
  minChoices: 1,
  maxChoices: 2,
  lockedIds: [],
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

  test("renders a decision with engine-locked picks", () => {
    const prompt = buildDecisionPromptViewModel(lockedDecision);

    expect(prompt.title).toBe("Choose a target");
    expect(prompt.candidates.map((candidate) => candidate.id)).toEqual(["unit-3", "unit-4"]);
    expect(prompt.lockedIds).toEqual(["unit-taunt"]);
  });

  test("renders a card selection with its range", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);

    expect(prompt.title).toBe("Choose cards");
    expect(prompt.minChoices).toBe(1);
    expect(prompt.maxChoices).toBe(2);
    expect(prompt.candidates).toHaveLength(2);
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
  test("accepts free selections within the range with candidate ids", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);
    expect(canSubmitDecision(prompt, [])).toBe(false);
    expect(canSubmitDecision(prompt, [101])).toBe(true);
    expect(canSubmitDecision(prompt, [101, 102])).toBe(true);
  });

  test("rejects selections outside the range or with unknown ids", () => {
    const prompt = buildDecisionPromptViewModel(cardDecision);
    expect(canSubmitDecision(prompt, [999])).toBe(false);
    expect(canSubmitDecision(prompt, [101, 102, 103])).toBe(false);
  });

  test("locked picks are not selectable and not required in the selection", () => {
    const prompt = buildDecisionPromptViewModel(lockedDecision);
    expect(canSubmitDecision(prompt, [])).toBe(false); // one free choice still required
    expect(canSubmitDecision(prompt, ["unit-3"])).toBe(true);
    expect(canSubmitDecision(prompt, ["unit-taunt"])).toBe(false); // not a candidate
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
