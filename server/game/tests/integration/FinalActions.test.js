import Card from "../../Card.js";
import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "../utils.js";

function setUnitAttributes(unit, attributes) {
  unit.card.attributes = attributes;
}

describe("final action integration", () => {
  test("equipping equipment attaches it and ends the turn", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Ignite Weapon", "Test Scout", "Test Scout"]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const unit = game.playerStates.Alice.field.frontline[0];

    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Ignite Weapon");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: unit.id },
    });

    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Test Ignite Weapon"]);
    expect(game.currentTurn).toBe("Bob");
  });

  test("a Living Ignition Weapon retains multiple distinct equipment definitions", () => {
    const game = setupGameWithCardsInHand([
      "Test Trait Unit",
      "Test Ignite Weapon",
      "Test Blue Thryssa",
      "Test Scout",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    setUnitAttributes(unit, ["living-ignition-weapon"]);

    for (const equipmentName of ["Test Ignite Weapon", "Test Blue Thryssa"]) {
      game.currentTurn = "Alice";
      const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === equipmentName);
      game.processAction({
        type: "equip-equipment-action",
        data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
      });
    }

    expect(unit.card.attributes).toContain("living-ignition-weapon");
    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Test Ignite Weapon", "Test Blue Thryssa"]);
  });

  test("regression: native compiled living-ignition-weapon attribute retains multiple equipment", () => {
    // No manual attribute injection: `Test Trait Unit` natively declares the
    // dashed compiled code, so the engine must honor the compiled card contract.
    const game = setupGameWithCardsInHand([
      "Test Trait Unit",
      "Test Ignite Weapon",
      "Test Blue Thryssa",
      "Test Scout",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    expect(unit.card.attributes).toContain("living-ignition-weapon");

    for (const equipmentName of ["Test Ignite Weapon", "Test Blue Thryssa"]) {
      game.currentTurn = "Alice";
      const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === equipmentName);
      game.processAction({
        type: "equip-equipment-action",
        data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
      });
    }

    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Test Ignite Weapon", "Test Blue Thryssa"]);
  });

  test("an Irregular replaces equipment instead of retaining multiple attachments", () => {
    const game = setupGameWithCardsInHand([
      "Test Trait Unit",
      "Test Ignite Weapon",
      "Test Blue Thryssa",
      "Test Scout",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    setUnitAttributes(unit, ["irregular"]);

    for (const equipmentName of ["Test Ignite Weapon", "Test Blue Thryssa"]) {
      game.currentTurn = "Alice";
      const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === equipmentName);
      game.processAction({
        type: "equip-equipment-action",
        data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
      });
    }

    expect(unit.card.attributes).toEqual(["irregular"]);
    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Test Blue Thryssa"]);
    expect(game.playerStates.Alice.hand.map((card) => card.name)).toContain("Test Ignite Weapon");
  });

  test("a Living Ignition Weapon rejects duplicate equipment definitions without mutation", () => {
    const game = setupGameWithCardsInHand([
      "Test Trait Unit",
      "Test Ignite Weapon",
      "Test Scout",
      "Test Scout",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    setUnitAttributes(unit, ["living-ignition-weapon"]);
    const narumadaId = getCardIdByName("Test Ignite Weapon");
    game.playerStates.Alice.hand.push(new Card(
      narumadaId,
      game.cards[narumadaId],
      "Alice",
      game.eventBus
    ));

    game.currentTurn = "Alice";
    let handId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Ignite Weapon");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
    });

    game.currentTurn = "Alice";
    handId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Ignite Weapon");
    const handSize = game.playerStates.Alice.hand.length;
    const shinsu = { ...game.playerStates.Alice.shinsu };

    expect(() => game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
    })).toThrow(/Living Ignition Weapon.*unique/i);

    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Test Ignite Weapon"]);
    expect(game.playerStates.Alice.hand).toHaveLength(handSize);
    expect(game.playerStates.Alice.shinsu).toEqual(shinsu);
  });

  test("client state exposes canonical equipmentAttachments without the legacy alias", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Ignite Weapon", "Test Scout", "Test Scout"]);
    advanceToRound(game, 3);
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const unit = game.playerStates.Alice.field.frontline[0];
    const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Ignite Weapon");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
    });

    const projectedUnit = game.getClientState("Alice").you.field.frontline[0];
    expect(projectedUnit.equipmentAttachments).toEqual(["Test Ignite Weapon"]);
    expect(projectedUnit).not.toHaveProperty("equipment");
    expect(unit).not.toHaveProperty("equipment");
  });

  test("a single-target skill pauses for target selection and resumes after resolution", () => {
    const game = setupGameWithCardsInHand(["Test Heal", "Test Scout", "Test Scout", "Test Scout"]);
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 0 };
    const targets = ["one", "two"].map((id) => ({
      id: `Unit#${id}`,
      owner: "Alice",
      card: { name: id, maxHp: 5 },
      currentHp: 1,
      isAlive: () => true,
    }));
    game.playerStates.Alice.field.frontline.push(...targets);

    const skillHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Heal");
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
