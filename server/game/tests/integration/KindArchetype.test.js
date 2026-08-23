import Card from "../../Card.js";
import ZoneService from "../../services/ZoneService.js";
import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";

function onField(game, username) {
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline];
}

function addToHand(game, username, cardName) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  ZoneService.addToHand(game.playerStates[username], card);
  return card;
}

// Deploy a card that is already in the player's hand (used for unreachable
// cards like the Conduit, which can never be part of a constructed deck).
function deployFromHand(game, username, cardName, positionCode) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "deploy-unit-action", data: { source: "player", username, handId, placedPositionCode: positionCode } });
  return onField(game, username).find((u) => u.card.name === cardName);
}

describe("kind archetype placement", () => {
  test("a shinheuh deploys to its authored line with no placed position", () => {
    const game = setupGameWithHands({ Alice: ["Test Shinheuh"] });
    const unit = deployUnit(game, "Alice", "Test Shinheuh", "frontline");

    expect(unit.line).toBe("frontline");
    expect(unit.placedPositionCode).toBe(null);
    expect(game.playerStates.Alice.field.frontline).toContain(unit);
  });

  test("a landmark deploys to the backline with no placed position", () => {
    const game = setupGameWithHands({ Alice: ["Test Landmark Unit"] });
    const unit = deployUnit(game, "Alice", "Test Landmark Unit", "backline");

    expect(unit.line).toBe("backline");
    expect(unit.placedPositionCode).toBe(null);
    expect(game.playerStates.Alice.field.backline).toContain(unit);
  });

  test("deploying a second landmark replaces the first", () => {
    const game = setupGameWithHands({ Alice: ["Test Landmark Unit", "Test Landmark Rules"] });
    const first = deployUnit(game, "Alice", "Test Landmark Unit", "backline");
    const second = deployUnit(game, "Alice", "Test Landmark Rules", "backline");

    expect(game._findUnit(first.id)).toBeNull();
    expect(game._findUnit(second.id)).toBe(second);
    expect(game.playerStates.Alice.field.backline.filter((u) => u.card.kind === "landmark")).toHaveLength(1);
  });

  test("a landmark with rules registers them on deploy", () => {
    const game = setupGameWithHands({ Alice: ["Test Landmark Rules"] });
    const unit = deployUnit(game, "Alice", "Test Landmark Rules", "backline");

    const mods = game.modifierStack.getModifiers(unit.id, "rule");
    expect(mods).toHaveLength(1);
    expect(mods[0].key).toBe("disable_passives");
    expect(mods[0].sourceType).toBe("landmark");
  });

  test("a conduit deploys to the backline without a position", () => {
    const game = setupGameWithHands({ Alice: [] });
    addToHand(game, "Alice", "Test Conduit");
    const unit = deployFromHand(game, "Alice", "Test Conduit", "backline");

    expect(unit.line).toBe("backline");
    expect(unit.placedPositionCode).toBe(null);
    expect(game.playerStates.Alice.field.backline).toContain(unit);
  });
});
