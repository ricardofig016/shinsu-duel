import LifecycleEngine from "../../services/LifecycleEngine.js";
import Card from "../../Card.js";
import EVT from "../../EventCatalog.js";
import { setupGameWithCardsInHand, getCardIdByName } from "../utils.js";

describe("evolution flow", () => {
  test("Karaka evolves when equipped with Karaka's Armor Suit as Fisherman", () => {
    const game = setupGameWithCardsInHand(["Test Evolve Unit", "Test Armor", "Test Evolve Unit", "Test Evolve Unit"]);
    game.round = 15;
    const shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.playerStates.Alice.shinsu = { ...shinsu };
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { ...shinsu };
    const karaka = game.playerStates.Alice.field.frontline[0];
    expect(karaka.card.name).toBe("Test Evolve Unit");

    // Equip Test Armor — should trigger evolution
    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Armor");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    // Test Evolve Unit should now be Test Evolve Unit II, HP delta preserved (7→9 max, full HP)
    expect(karaka.card.name).toBe("Test Evolve Unit II");
    expect(karaka.currentHp).toBe(9);

    // Evolved unit should have its new passive (round end: deal 3 to all Rooted enemies)
    const passives = karaka.card.passiveAbilities;
    expect(passives.some((p) => p.trigger?.type === "round_end")).toBe(true);
  });

  test("Karaka does NOT evolve when equipped in wrong position — req blocks", () => {
    const game = setupGameWithCardsInHand(["Test Evolve Unit", "Test Armor", "Test Evolve Unit", "Test Evolve Unit"]);
    game.round = 15;
    const shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.playerStates.Alice.shinsu = { ...shinsu };
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { ...shinsu };
    const karaka = game.playerStates.Alice.field.frontline[0];

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Armor");
    expect(() => game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    })).toThrow(/deployed as fisherman/i);

    expect(karaka.card.name).toBe("Test Evolve Unit");
  });

  test("evolved unit retains conditions after transformation", () => {
    const game = setupGameWithCardsInHand(["Test Evolve Unit", "Test Armor", "Test Evolve Unit", "Test Evolve Unit"]);
    game.round = 15;
    const shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.playerStates.Alice.shinsu = { ...shinsu };
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { ...shinsu };
    const karaka = game.playerStates.Alice.field.frontline[0];

    // Apply a condition before evolution
    game.modifierStack.apply({ sourceId: "test", sourceType: "system", targetId: karaka.id, type: "condition", key: "burned", value: 1 });

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Armor");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    expect(karaka.card.name).toBe("Test Evolve Unit II");
    expect(game.modifierStack.getEffective(karaka.id, "condition", "burned")).toBe(1);
  });

  test("3-card chain evolves twice: Test Chain Unit -> II -> III", () => {
    const game = setupGameWithCardsInHand(["Test Chain Unit", "Test Armor"]);
    game.round = 15;
    const shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };

    game.playerStates.Alice.shinsu = { ...shinsu };
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    const unit = game.playerStates.Alice.field.frontline[0];
    expect(unit.card.name).toBe("Test Chain Unit II");
    expect(unit.currentHp).toBe(5);

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Armor");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: unit.id },
    });

    expect(unit.card.name).toBe("Test Chain Unit III");
    expect(unit.currentHp).toBe(7);
    expect(unit.card.evolvedFrom).toBe(getCardIdByName("Test Chain Unit II"));
    expect(unit.card.evolveInto).toBeNull();
  });
});

describe("ignition revert on unequip", () => {
  test("ignited Narumada reverts to base form when unequipped", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Ignite Weapon", "Test Scout", "Test Scout"]);
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    // Attach Narumada
    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Ignite Weapon");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: bearer.id },
    });
    game.currentTurn = "Alice";

    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);

    // Manually trigger ignition by simulating slay
    const victimCardId = getCardIdByName("Test Scout");
    const victimCard = new Card(victimCardId, game.cards[victimCardId], "Bob", game.eventBus);
    const victim = {
      id: "Unit#revert-victim",
      owner: "Bob",
      card: victimCard,
      currentHp: 3,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
      toSanitizedObject() { return { id: this.id, currentHp: this.currentHp, owner: this.owner }; },
    };
    game.playerStates.Bob.field.frontline.push(victim);
    game._indexUnit(victim);

    // Emit kill event to trigger ignition
    game.eventBus.emit(EVT.UNIT_KILLED, { sourceId: bearer.id, targetId: victim.id, killerId: bearer.id });

    // Narumada should be ignited
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon - Ignited"]);

    // Detach → should revert to base form in hand
    LifecycleEngine.detachEquipment(game, bearer);
    expect(bearer.equipmentAttachments.length).toBe(0);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(true);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Ignite Weapon - Ignited")).toBe(false);
  });
});
