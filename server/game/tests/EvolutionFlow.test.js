import LifecycleEngine from "../services/LifecycleEngine.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";
import { setupGameWithCardsInHand, getCardIdByName } from "./utils.js";

describe("evolution flow", () => {
  test("Karaka evolves when equipped with Karaka's Armor Suit as Fisherman", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka", "Karaka"]);
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
    expect(karaka.card.name).toBe("Karaka");

    // Equip Karaka's Armor Suit — should trigger evolution
    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    // Karaka should now be Karaka - Evolved, HP delta preserved (7→9 max, full HP)
    expect(karaka.card.name).toBe("Karaka - Evolved");
    expect(karaka.currentHp).toBe(9);

    // Evolved unit should have its new passive (round end: deal 3 to all Rooted enemies)
    const passives = karaka.card.passiveAbilities;
    expect(passives.some((p) => p.trigger === "round end")).toBe(true);
  });

  test("Karaka does NOT evolve when equipped in wrong position — req blocks", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka", "Karaka"]);
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

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
    expect(() => game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    })).toThrow(/deployed as fisherman/i);

    expect(karaka.card.name).toBe("Karaka");
  });

  test("evolved unit retains conditions after transformation", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka", "Karaka"]);
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

    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: karaka.id },
    });

    expect(karaka.card.name).toBe("Karaka - Evolved");
    expect(game.modifierStack.getEffective(karaka.id, "condition", "burned")).toBe(1);
  });
});

describe("ignition revert on unequip", () => {
  test("ignited Narumada reverts to base form when unequipped", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Narumada", "Monkeyman", "Monkeyman"]);
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    // Attach Narumada
    const equipIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Narumada");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipIdx, targetUnitId: bearer.id },
    });
    game.currentTurn = "Alice";

    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Narumada"]);

    // Manually trigger ignition by simulating slay
    const victimCardId = getCardIdByName("Monkeyman");
    const victimCard = new Card(victimCardId, game.constructor.cards[victimCardId], "Bob", game.eventBus);
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
    expect(bearer.equipmentAttachments.map((c) => c.name)).toEqual(["Narumada - Ignited"]);

    // Detach → should revert to base form in hand
    LifecycleEngine.detachEquipment(game, bearer);
    expect(bearer.equipmentAttachments.length).toBe(0);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Narumada")).toBe(true);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Narumada - Ignited")).toBe(false);
  });
});
