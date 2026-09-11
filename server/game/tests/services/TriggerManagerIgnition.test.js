import LifecycleEngine from "../../services/LifecycleEngine.js";
import Card from "../../Card.js";
import EVT from "../../EventCatalog.js";
import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "../utils.js";

describe("TriggerManager ignition and given triggers", () => {
  test("a slay while equipped with Narumada ignites it into Narumada - Ignited", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Ignite Weapon", "Test Scout", "Test Scout"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Ignite Weapon");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: bearer.id },
    });
    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Test Ignite Weapon"]);

    const victimCardId = getCardIdByName("Test Scout");
    const victimCard = new Card(victimCardId, game.cards[victimCardId], "Bob", game.eventBus);
    const victim = {
      id: "Unit#ignition-victim",
      owner: "Bob",
      card: victimCard,
      currentHp: 1,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(victim);

    game.eventBus.emit(EVT.DAMAGE_INTENT, { sourceId: bearer.id, targetId: victim.id, amount: 5 });
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: bearer.id, targetId: victim.id, amount: 5 });
    game.eventBus.emit(EVT.UNIT_KILLED, { sourceId: bearer.id, targetId: victim.id, killerId: bearer.id });

    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Test Ignite Weapon - Ignited"]);
  });

  test("a 10+ hit ignites through the damage threshold and the bearer evolves on the ignition", () => {
    const game = setupGameWithCardsInHand(["Test Ignition Evolver", "Test Threshold Igniter"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Threshold Igniter");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: bearer.id },
    });

    // Below the threshold: neither the ignition nor the evolution fires.
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: bearer.id, targetId: "Unit#victim", amount: 9, hitAmount: 9 });
    expect(bearer.card.name).toBe("Test Ignition Evolver");
    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Test Threshold Igniter"]);

    // At the threshold the equipment ignites and "when my equipment ignites"
    // evolves the bearer in the same event's resolution.
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: bearer.id, targetId: "Unit#victim", amount: 10, hitAmount: 10 });
    expect(bearer.card.name).toBe("Test Ignition Evolver II");
    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Test Threshold Igniter - Ignited"]);
  });

  test("the damage threshold falls back to the applied amount for payloads without hitAmount", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Threshold Igniter"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Threshold Igniter");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: bearer.id },
    });

    // Damage events emitted without the full-hit amount still honor the
    // threshold via the applied amount.
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: bearer.id, targetId: "Unit#victim", amount: 10 });
    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Test Threshold Igniter - Ignited"]);
  });
});
