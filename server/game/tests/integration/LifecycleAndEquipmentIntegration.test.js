import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";
import Card from "../../Card.js";
import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

function addCardToHand(game, username, cardName) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
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

describe("lifecycle and equipment integration", () => {
  test("Khun Ran - Evolved reverts at round end, creating Redan and reverting to Khun Ran", () => {
    const game = setupGameWithHands({ Alice: ["Test Multi Position - Evolved"] });
    const unit = deployUnit(game, "Alice", "Test Multi Position - Evolved", "fisherman");

    game.eventBus.emit(EVT.ROUND_END, { round: game.round });

    expect(unit.card.name).toBe("Test Multi Position");
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Poison Skill")).toBe(true);
  });

  test("equipping all 4 Thorn Fragments discards them and creates Enryu's Thorn", () => {
    const game = setupGameWithHands({ Alice: ["Test Trait Unit"] });
    const bearer = deployUnit(game, "Alice", "Test Trait Unit", "fisherman");
    // Living Ignition Weapon: retain multiple distinct equipment (see FinalActions).
    bearer.card.attributes = ["living-ignition-weapon"];

    const fragments = [
      "Test Thorn Fragment I",
      "Test Thorn Fragment II",
      "Test Thorn Fragment III",
      "Test Thorn Fragment IV",
    ];
    for (const name of fragments) addCardToHand(game, "Alice", name);

    for (const name of fragments) {
      equipFromHand(game, bearer, name);
      if (name === "Test Thorn Fragment IV") break;
      expect(bearer.equipmentAttachments.length).toBeGreaterThan(0);
    }

    // has_all_equipped fired on the fourth attach: all 4 discarded, Enryu's Thorn created.
    expect(bearer.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Thorn")).toBe(true);
  });
});
