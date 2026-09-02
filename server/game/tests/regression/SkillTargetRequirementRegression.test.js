/**
 * Regression: a skill with a target requirement ("target is an ally") is
 * validated as an existence check at play time — the skill-play path carries
 * no target unit, so the concrete unit is chosen through target selection
 * after the play resolves.
 *
 * Bug: RequirementValidator required a concrete targetUnit/sourceUnit pair at
 * validation time (the equipment-attachment model). The skill-play path passes
 * neither, so Redan — the only card with a target requirement — was rejected
 * on every play attempt with "Requirement not met: target must be an ally".
 */

import { setupGameWithHands, deployUnit } from "../utils.js";

const SKILL_NAME = "Test Target Ally Skill";

describe("Skill target requirement regression", () => {
  test("plays the skill when an allied unit exists and auto-resolves the forced ally target", () => {
    const game = setupGameWithHands({ Alice: [SKILL_NAME, "Test Scout"] });
    const unit = deployUnit(game, "Alice", "Test Scout", "fisherman");
    game.currentTurn = "Alice";

    const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === SKILL_NAME);
    game.processAction({
      type: "play-skill-action",
      data: { source: "player", username: "Alice", handId },
    });

    expect(game.pendingDecision).toBeNull();
    expect(game.modifierStack.has(unit.id, "condition", "poisoned")).toBe(true);
    expect(game.currentTurn).toBe("Bob");
  });

  test("offers target selection among allied units when the choice is not forced", () => {
    const game = setupGameWithHands({ Alice: [SKILL_NAME, "Test Scout", "Test Fisherman Unit"] });
    const scout = deployUnit(game, "Alice", "Test Scout", "fisherman");
    const fisherman = deployUnit(game, "Alice", "Test Fisherman Unit", "fisherman");
    game.currentTurn = "Alice";
    game.currentTurn = "Alice";

    const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === SKILL_NAME);
    game.processAction({
      type: "play-skill-action",
      data: { source: "player", username: "Alice", handId },
    });

    expect(game.pendingDecision?.type).toBe("target_selection");
    expect(game.pendingDecision.candidates.map((candidate) => candidate.id).sort())
      .toEqual([scout.id, fisherman.id].sort());

    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [fisherman.id],
    });

    expect(game.modifierStack.has(fisherman.id, "condition", "poisoned")).toBe(true);
    expect(game.modifierStack.has(scout.id, "condition", "poisoned")).toBe(false);
    expect(game.currentTurn).toBe("Bob");
  });

  test("rejects the skill before paying when no allied unit exists", () => {
    const game = setupGameWithHands({ Alice: [SKILL_NAME] });
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };

    const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === SKILL_NAME);
    expect(() =>
      game.processAction({
        type: "play-skill-action",
        data: { source: "player", username: "Alice", handId },
      })
    ).toThrow(/need an allied unit on your board/i);

    expect(game.playerStates.Alice.hand[handId].name).toBe(SKILL_NAME);
    expect(game.playerStates.Alice.shinsu.normalAvailable).toBe(5);
    expect(game.currentTurn).toBe("Alice");
    expect(game.pendingDecision).toBeNull();
  });
});
