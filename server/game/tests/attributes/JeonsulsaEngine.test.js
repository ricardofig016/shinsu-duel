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

// Bare capacity fillers: the Conduit summon's line-cap check only reads the
// destination line's length, mirroring the SummonHandler/StealHandler tests.
function filler(id, name) {
  return { id, card: { name }, currentHp: 1 };
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

  test("deploying a Jeonsulsa unit with an enemy Conduit on the field heals it 2 HP without raising max HP", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    addToHand(game, "Bob", "Conduit");
    const existing = deployFromHand(game, "Bob", "Conduit", "backline");
    expect(existing.currentHp).toBe(2);

    const heals = [];
    game.eventBus.on(EVT.HEAL_APPLIED, (p) => heals.push(p), { phase: "pre" });

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    const conduit = findConduit(game, "Bob");
    expect(conduit).toBe(existing);
    // Heal semantics: the fixed 8 max HP is untouched; only current HP rises.
    expect(conduit.card.maxHp).toBe(8);
    expect(conduit.currentHp).toBe(4);
    expect(heals).toHaveLength(1);
    expect(heals[0].targetId).toBe(conduit.id);
    expect(heals[0].amount).toBe(2);
    expect(heals[0].currentHp).toBe(4);
  });

  test("the deploy heal is capped at the Conduit's max HP", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    addToHand(game, "Bob", "Conduit");
    const existing = deployFromHand(game, "Bob", "Conduit", "backline");
    UnitService.setHp(existing, 7);

    const heals = [];
    game.eventBus.on(EVT.HEAL_APPLIED, (p) => heals.push(p), { phase: "pre" });

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    expect(existing.card.maxHp).toBe(8);
    expect(existing.currentHp).toBe(8);
    expect(heals).toHaveLength(1);
    expect(heals[0].amount).toBe(1);
  });

  test("deploying onto a full-HP Conduit heals nothing and emits no event", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    addToHand(game, "Bob", "Conduit");
    const existing = deployFromHand(game, "Bob", "Conduit", "backline");
    UnitService.setHp(existing, 8);

    const heals = [];
    game.eventBus.on(EVT.HEAL_APPLIED, (p) => heals.push(p), { phase: "pre" });

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    expect(existing.currentHp).toBe(8);
    expect(heals).toHaveLength(0);
  });

  test("heal amplifiers on the deploying Jeonsulsa increase the Conduit heal", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    addToHand(game, "Bob", "Conduit");
    const existing = deployFromHand(game, "Bob", "Conduit", "backline");
    UnitService.setHp(existing, 1);

    // The second Jeonsulsa is the heal's source; its heal amplifier must
    // apply to the deploy heal like to any other heal it performs.
    const amplifierSource = { id: "Unit#jeonsulsa-amp", owner: "Alice", card: { attributes: ["jeonsulsa"] } };
    game.modifierStack.apply({
      sourceId: "System",
      sourceType: "system",
      targetId: amplifierSource.id,
      type: "stat",
      key: "heal",
      value: 1,
    });

    const engine = game._attributeRegistry.get("jeonsulsa");
    engine.onDeploy(amplifierSource, game);

    expect(existing.currentHp).toBe(4);
  });

  test("deploying a Jeonsulsa unit when the enemy backline is full fizzles the summon and discards the Conduit card", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    game.playerStates.Bob.field.backline = [
      filler("F1", "A"), filler("F2", "B"), filler("F3", "C"), filler("F4", "D"), filler("F5", "E"),
    ];
    const fizzles = [];
    game.eventBus.on(EVT.UNIT_SUMMON_FIZZLED, (p) => fizzles.push(p), { phase: "pre" });

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    expect(findConduit(game, "Bob")).toBeNull();
    expect(game.playerStates.Bob.field.backline).toHaveLength(5);
    expect(fizzles).toHaveLength(1);
    expect(fizzles[0].owner).toBe("Bob");
    expect(fizzles[0].cardName).toBe("Conduit");
    expect(fizzles[0].line).toBe("backline");
    // A failed summon discards the summoned unit (RULES.md §Summons).
    expect(game.playerStates.Bob.discard.some((c) => c.name === "Conduit")).toBe(true);
  });

  test("the existing-Conduit heal runs even when the enemy backline is full", () => {
    const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: [] });
    game.playerStates.Bob.field.backline = [
      filler("F1", "A"), filler("F2", "B"), filler("F3", "C"), filler("F4", "D"), filler("F5", "E"),
    ];
    const conduitUnit = {
      id: "Unit#conduit-hosted",
      owner: "Bob",
      card: { name: "Conduit", kind: "conduit", maxHp: 8, entryHp: 2 },
      currentHp: 2,
      isAlive: () => true,
    };
    game.playerStates.Bob.field.backline[0] = conduitUnit;

    deployUnit(game, "Alice", "Test Khun Ran", "fisherman");

    expect(conduitUnit.currentHp).toBe(4);
    expect(game.playerStates.Bob.discard).toHaveLength(0);
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
