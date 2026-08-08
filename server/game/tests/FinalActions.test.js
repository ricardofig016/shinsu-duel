import Card from "../Card.js";
import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "./utils.js";

function setUnitAttributes(unit, attributes) {
  unit.card.attributes = attributes;
}

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

    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Narumada"]);
    expect(game.currentTurn).toBe("Bob");
  });

  test("a Living Ignition Weapon retains multiple distinct equipment definitions", () => {
    const game = setupGameWithCardsInHand([
      "_Test Unit",
      "Narumada",
      "Blue Thryssa",
      "Monkeyman",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    setUnitAttributes(unit, ["living ignition weapon"]);

    for (const equipmentName of ["Narumada", "Blue Thryssa"]) {
      game.currentTurn = "Alice";
      const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === equipmentName);
      game.processAction({
        type: "equip-equipment-action",
        data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
      });
    }

    expect(unit.card.attributes).toContain("living ignition weapon");
    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Narumada", "Blue Thryssa"]);
  });

  test("an Irregular replaces equipment instead of retaining multiple attachments", () => {
    const game = setupGameWithCardsInHand([
      "_Test Unit",
      "Narumada",
      "Blue Thryssa",
      "Monkeyman",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    setUnitAttributes(unit, ["irregular"]);

    for (const equipmentName of ["Narumada", "Blue Thryssa"]) {
      game.currentTurn = "Alice";
      const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === equipmentName);
      game.processAction({
        type: "equip-equipment-action",
        data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
      });
    }

    expect(unit.card.attributes).toEqual(["irregular"]);
    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Blue Thryssa"]);
    expect(game.playerStates.Alice.hand.map((card) => card.name)).toContain("Narumada");
  });

  test("a Living Ignition Weapon rejects duplicate equipment definitions without mutation", () => {
    const game = setupGameWithCardsInHand([
      "_Test Unit",
      "Narumada",
      "Monkeyman",
      "Monkeyman",
    ]);
    advanceToRound(game, 3);

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "wave-controller" },
    });
    const unit = game.playerStates.Alice.field.frontline[0];
    setUnitAttributes(unit, ["living ignition weapon"]);
    const narumadaId = getCardIdByName("Narumada");
    game.playerStates.Alice.hand.push(new Card(
      narumadaId,
      game.constructor.cards[narumadaId],
      "Alice",
      game.eventBus
    ));

    game.currentTurn = "Alice";
    let handId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Narumada");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
    });

    game.currentTurn = "Alice";
    handId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Narumada");
    const handSize = game.playerStates.Alice.hand.length;
    const shinsu = { ...game.playerStates.Alice.shinsu };

    expect(() => game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
    })).toThrow(/Living Ignition Weapon.*unique/i);

    expect(unit.equipmentAttachments.map((card) => card.name)).toEqual(["Narumada"]);
    expect(game.playerStates.Alice.hand).toHaveLength(handSize);
    expect(game.playerStates.Alice.shinsu).toEqual(shinsu);
  });

  test("client state exposes canonical equipmentAttachments without the legacy alias", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Narumada", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 3);
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const unit = game.playerStates.Alice.field.frontline[0];
    const handId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Narumada");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId, targetUnitId: unit.id },
    });

    const projectedUnit = game.getClientState("Alice").you.field.frontline[0];
    expect(projectedUnit.equipmentAttachments).toEqual(["Narumada"]);
    expect(projectedUnit).not.toHaveProperty("equipment");
    expect(unit).not.toHaveProperty("equipment");
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
