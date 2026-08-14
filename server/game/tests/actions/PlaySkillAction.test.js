import { setupGameWithCardsInHand, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";

describe("PlaySkillAction", () => {
  test("plays a structured skill, applies effects, discards it, and ends the turn", () => {
    const game = setupGameWithCardsInHand(["Healing Potion", "Healing Potion", "Healing Potion", "Healing Potion"]);
    const unitCard = new Card(
      getCardIdByName("Monkeyman"),
      game.constructor.cards[getCardIdByName("Monkeyman")],
      "Alice",
      game.eventBus
    );
    const unit = { id: "Unit#healing-target", owner: "Alice", card: unitCard, currentHp: 1, isAlive: () => true };
    game.playerStates.Alice.field.frontline.push(unit);
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 2, recharged: 0 };

    game.processAction({
      type: "play-skill-action",
      data: { source: "player", username: "Alice", handId: 0 },
    });

    expect(unit.currentHp).toBe(unitCard.maxHp);
    expect(game.playerStates.Alice.discard.at(-1).name).toBe("Healing Potion");
    expect(game.currentTurn).toBe("Bob");
  });
});
