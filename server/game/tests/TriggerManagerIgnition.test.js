import LifecycleEngine from "../services/LifecycleEngine.js";
import Card from "../Card.js";
import EVT from "../EventCatalog.js";
import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "./utils.js";

describe("TriggerManager ignition and given triggers", () => {
  test("a slay while equipped with Narumada ignites it into Narumada - Ignited", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Narumada", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Narumada");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: bearer.id },
    });
    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Narumada"]);

    const victimCardId = getCardIdByName("Monkeyman");
    const victimCard = new Card(victimCardId, game.constructor.cards[victimCardId], "Bob", game.eventBus);
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

    expect(bearer.equipmentAttachments.map((card) => card.name)).toEqual(["Narumada - Ignited"]);
  });
});
