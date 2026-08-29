import Card from "../../Card.js";
import EVT from "../../EventCatalog.js";
import UnitService from "../../services/UnitService.js";
import ZoneService from "../../services/ZoneService.js";
import JeonsulsaEngine from "../../attributes/JeonsulsaEngine.js";
import { createTestGame, setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";

// The Conduit is unreachable (never part of a constructed deck), so tests add
// it to a hand directly and deploy it from there.
function addToHand(game, username, cardName) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  ZoneService.addToHand(game.playerStates[username], card);
  return card;
}

function deployFromHand(game, username, cardName, positionCode) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "deploy-unit-action", data: { source: "player", username, handId, placedPositionCode: positionCode } });
  return [...game.playerStates[username].field.frontline, ...game.playerStates[username].field.backline]
    .find((u) => u.card.name === cardName);
}

function findConduit(game, username) {
  const field = game.playerStates[username].field;
  return [...field.frontline, ...field.backline].find((u) => u.card.name === "Conduit") ?? null;
}

describe("JeonsulsaEngine", () => {
  test("is registered on the attribute registry with access to the card catalog", () => {
    const game = createTestGame();
    const engine = game._attributeRegistry.get("jeonsulsa");
    expect(engine).toBeInstanceOf(JeonsulsaEngine);
    expect(engine._cards).toBe(game.cards);
  });

  test("deploying a Jeonsulsa unit with no enemy Conduit summons one on the enemy backline at 8 max HP, 2 current HP", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    const damageEvents = [];
    game.eventBus.on(EVT.DAMAGE_APPLIED, (payload) => damageEvents.push(payload), { phase: "pre" });

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    const conduit = findConduit(game, "Bob");
    expect(conduit).not.toBeNull();
    expect(conduit.owner).toBe("Bob");
    expect(conduit.line).toBe("backline");
    expect(conduit.placedPositionCode).toBeNull();
    // Entry HP is consumed at unit creation: the Conduit is initialized at
    // 2/8 with no damage event — entry is initialization, not damage.
    expect(conduit.card.entryHp).toBe(2);
    expect(conduit.card.maxHp).toBe(8);
    expect(conduit.currentHp).toBe(2);
    expect(damageEvents).toHaveLength(0);
  });

  test("deploying a Jeonsulsa unit with an enemy Conduit on the field grants it +2 max and current HP", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    addToHand(game, "Bob", "Conduit");
    const existing = deployFromHand(game, "Bob", "Conduit", "backline");
    expect(existing.currentHp).toBe(2);

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    const conduit = findConduit(game, "Bob");
    expect(conduit).toBe(existing);
    expect(conduit.card.maxHp).toBe(10);
    expect(conduit.currentHp).toBe(4);
  });

  test("the grant preserves the lost-HP delta of a damaged Conduit", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    addToHand(game, "Bob", "Conduit");
    const existing = deployFromHand(game, "Bob", "Conduit", "backline");
    UnitService.setHp(existing, 3);

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    expect(existing.card.maxHp).toBe(10);
    expect(existing.currentHp).toBe(5);
  });

  test("resolves the enemy owner in a two-player game in both directions", () => {
    const game = createTestGame();
    const engine = game._attributeRegistry.get("jeonsulsa");

    // A Jeonsulsa unit owned by Bob summons the Conduit on Alice's backline.
    engine.onDeploy({ owner: "Bob", card: { attributes: ["jeonsulsa"] } }, game);
    const conduit = findConduit(game, "Alice");
    expect(conduit).not.toBeNull();
    expect(conduit.owner).toBe("Alice");
    expect(conduit.currentHp).toBe(2);
  });
});
