import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";
import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

function addCardToHand(game, username, cardName) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.constructor.cards[cardId], username, game.eventBus);
  ZoneService.addToHand(game.playerStates[username], card);
  return card;
}

function equipFromHand(game, unit, cardName) {
  game.currentTurn = unit.owner;
  game.round = 15;
  game.playerStates[unit.owner].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[unit.owner].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "equip-equipment-action", data: { source: "player", username: unit.owner, handId, targetUnitId: unit.id } });
}

describe("Phase E integration", () => {
  test("Khun Ran - Evolved reverts at round end, creating Redan and reverting to Khun Ran", () => {
    const game = setupGameWithHands({ Alice: ["Khun Ran - Evolved"] });
    const unit = deployUnit(game, "Alice", "Khun Ran - Evolved", "fisherman");

    game.eventBus.emit(EVT.ROUND_END, { round: game.round });

    expect(unit.card.name).toBe("Khun Ran");
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Redan")).toBe(true);
  });

  test("equipping all 4 Thorn Fragments discards them and creates Enryu's Thorn", () => {
    const game = setupGameWithHands({ Alice: ["_Test Unit"] });
    const bearer = deployUnit(game, "Alice", "_Test Unit", "fisherman");
    // Living Ignition Weapon: retain multiple distinct equipment (see FinalActions).
    bearer.card.attributes = ["living ignition weapon"];

    const fragments = [
      "First Thorn Fragment",
      "Second Thorn Fragment",
      "Third Thorn Fragment",
      "Fourth Thorn Fragment",
    ];
    for (const name of fragments) addCardToHand(game, "Alice", name);

    for (const name of fragments) {
      equipFromHand(game, bearer, name);
      if (name === "Fourth Thorn Fragment") break;
      expect(bearer.equipmentAttachments.length).toBeGreaterThan(0);
    }

    // has_all_equipped fired on the fourth attach: all 4 discarded, Enryu's Thorn created.
    expect(bearer.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Enryu's Thorn")).toBe(true);
  });
});
