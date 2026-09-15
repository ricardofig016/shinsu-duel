import { setupGameWithCardsInHand, getCardIdByName, confirmPendingDecision } from "../utils.js";
import Card from "../../Card.js";

describe("PlaySkillAction", () => {
  test("plays a structured skill, applies effects, discards it, and ends the turn", () => {
    const game = setupGameWithCardsInHand(["Test Heal", "Test Heal", "Test Heal", "Test Heal"]);
    const unitCard = new Card(
      getCardIdByName("Test Scout"),
      game.cards[getCardIdByName("Test Scout")],
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
    // The heal's single legal target is presented as a committed decision; the
    // turn end stays deferred until it is confirmed.
    confirmPendingDecision(game);

    expect(unit.currentHp).toBe(unitCard.maxHp);
    expect(game.playerStates.Alice.discard.at(-1).name).toBe("Test Heal");
    expect(game.currentTurn).toBe("Bob");
  });
});
