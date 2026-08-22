import LifecycleEngine from "../../services/LifecycleEngine.js";
import Card from "../../Card.js";
import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "../utils.js";

describe("granted abilities can be used by their bearer", () => {
  test("Purple Dementor grants a usable poison ability that disappears when unequipped", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Grant Ability Equip", "Test Scout", "Test Scout"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Test Grant Ability Equip");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: bearer.id },
    });
    game.currentTurn = "Alice";

    const grantedEntries = game._abilityRegistry.getGranted(bearer.id);
    expect(grantedEntries.length).toBe(1);
    const abilityCode = grantedEntries[0].code;

    expect(game.getClientState("Alice").you.field.frontline[0].grantedAbilities)
      .toEqual(expect.arrayContaining([expect.objectContaining({ abilityCode })]));

    const victimCardId = getCardIdByName("Test Scout");
    const victimCard = new Card(victimCardId, game.cards[victimCardId], "Bob", game.eventBus);
    const victim = {
      id: "Unit#granted-ability-victim",
      owner: "Bob",
      card: victimCard,
      currentHp: victimCard.maxHp,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(victim);

    game.processAction({
      type: "use-ability-action",
      data: { source: "player", username: "Alice", unitId: bearer.id, abilityCode },
    });

    expect(game.modifierStack.getEffective(victim.id, "condition", "poisoned")).toBe(4);

    LifecycleEngine.detachEquipment(game, bearer);
    expect(game._abilityRegistry.getGranted(bearer.id).length).toBe(0);
  });
});
