import LifecycleEngine from "../services/LifecycleEngine.js";
import Card from "../Card.js";
import { setupGameWithCardsInHand, advanceToRound, getCardIdByName } from "./utils.js";

describe("granted abilities can be used by their bearer", () => {
  test("Purple Dementor grants a usable poison ability that disappears when unequipped", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Purple Dementor", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 3);
    game.currentTurn = "Alice";

    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    game.currentTurn = "Alice";
    const bearer = game.playerStates.Alice.field.frontline[0];

    const equipmentHandId = game.playerStates.Alice.hand.findIndex((card) => card.name === "Purple Dementor");
    game.processAction({
      type: "equip-equipment-action",
      data: { source: "player", username: "Alice", handId: equipmentHandId, targetUnitId: bearer.id },
    });
    game.currentTurn = "Alice";

    const grantedMod = game.modifierStack.getModifiers(bearer.id, "ability").find((mod) => mod.enabled);
    expect(grantedMod).toBeDefined();
    const abilityCode = `granted:${grantedMod.id}`;

    expect(game.getClientState("Alice").you.field.frontline[0].grantedAbilities)
      .toEqual(expect.arrayContaining([expect.objectContaining({ abilityCode })]));

    const victimCardId = getCardIdByName("Monkeyman");
    const victimCard = new Card(victimCardId, game.constructor.cards[victimCardId], "Bob", game.eventBus);
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
    expect(game.modifierStack.getModifiers(bearer.id, "ability").some((mod) => mod.enabled)).toBe(false);
  });
});
