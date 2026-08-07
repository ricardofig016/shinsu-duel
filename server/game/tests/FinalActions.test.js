import { setupGameWithCardsInHand, advanceToRound } from "./utils.js";

describe("final action integration", () => {
  test("equipping equipment attaches it and ends the turn", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Narumada", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const unit = game.playerStates.Alice.field.frontline[0];

    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Narumada");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: unit.id },
    });

    expect(unit.equipment.name).toBe("Narumada");
    expect(game.currentTurn).toBe("Bob");
  });

  test("a single-target skill pauses for target selection and resumes after resolution", () => {
    const game = setupGameWithCardsInHand(["Healing Potion", "Monkeyman", "Monkeyman", "Monkeyman"]);
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 0 };
    const targets = ["one", "two"].map((id) => ({
      id: `Unit#${id}`,
      owner: "Alice",
      card: { name: id, maxHp: 5 },
      currentHp: 1,
      isAlive: () => true,
    }));
    game.playerStates.Alice.field.frontline.push(...targets);

    const skillHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Healing Potion");
    game.processAction({
      type: "play-skill-action",
      data: { source: "player", username: "Alice", handId: skillHandId },
    });

    expect(game.pendingDecision?.type).toBe("target_selection");
    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [targets[1].id],
    });
    expect(targets[1].currentHp).toBe(5);
  });
});
