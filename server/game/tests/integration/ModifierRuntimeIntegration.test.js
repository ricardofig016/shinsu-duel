import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";
import { resolveTargets } from "../../TargetResolver.js";
import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";

function putInHand(game, username, name) {
  const cardId = getCardIdByName(name);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  game.playerStates[username].hand.push(card);
  return card;
}

function stubUnit(game, username, cardName, position, hpOverride = null) {
  const cardId = getCardIdByName(cardName);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  const unit = {
    id: `Unit#stub#${cardName}#${username}`,
    owner: username,
    card,
    currentHp: hpOverride ?? card.maxHp,
    placedPositionCode: position,
    isAlive() { return this.currentHp > 0; },
  };
  game.playerStates[username].field.frontline.push(unit);
  game._indexUnit(unit);
  return unit;
}

function equip(game, username, equipmentName, targetUnit) {
  putInHand(game, username, equipmentName);
  game.currentTurn = username;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 20, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === equipmentName);
  // Bypass the equip action's requirement check (e.g. Ice Spear's "khun family")
  // and attach through the authoritative engine to exercise modifier resolution.
  LifecycleEngine.attachEquipment(game, username, handId, targetUnit);
}

function useAbility(game, username, unit, abilityCode) {
  game.currentTurn = username;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
  game.processAction({ type: "use-ability-action", data: { source: "player", username, unitId: unit.id, abilityCode } });
}

describe("Modifier runtime integration", () => {
  test("Enryu's Thorn raises the bearer's HP (current+max) and damage, and revokes on detach", () => {
    const game = setupGameWithHands({ Alice: ["Test Fisherman Unit"], Bob: [] });
    const bearer = deployUnit(game, "Alice", "Test Fisherman Unit", "fisherman");
    const beforeMax = bearer.card.maxHp;
    const beforeCurrent = bearer.currentHp;

    equip(game, "Alice", "Test Thorn", bearer);

    expect(bearer.card.maxHp).toBe(beforeMax + 2);
    expect(bearer.currentHp).toBe(beforeCurrent + 2);
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman");
    expect(game.modifierStack.getDamageDealt(bearer, enemy)).toBe(2);

    LifecycleEngine.detachEquipment(game, bearer);
    expect(bearer.card.maxHp).toBe(beforeMax);
    expect(bearer.currentHp).toBe(beforeCurrent);
    expect(game.modifierStack.getDamageDealt(bearer, enemy)).toBe(0);
  });

  test("Karaka grants Quick to allied karaka's servants", () => {
    const game = setupGameWithHands({ Alice: ["Test Evolve Unit", "Test Scout Ranker"], Bob: [] });
    deployUnit(game, "Alice", "Test Evolve Unit", "fisherman");
    const pedro = deployUnit(game, "Alice", "Test Scout Ranker", "scout");

    expect(game.modifierStack.getKeywords(pedro, true).has("quick")).toBe(true);
  });

  test("Edin Dan's first ability each round is Free (no combat slot consumed)", () => {
    const game = setupGameWithHands({ Alice: ["Test Free Keyword Unit"], Bob: [] });
    const edin = deployUnit(game, "Alice", "Test Free Keyword Unit", "scout");

    useAbility(game, "Alice", edin, "0");
    expect(game.playerStates.Alice.combatSlots.scout.available).toBe(true);

    useAbility(game, "Alice", edin, "1");
    expect(game.playerStates.Alice.combatSlots.scout.available).toBe(false);
  });

  test("Phobos makes the bearer's ability trigger twice", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const monkey = deployUnit(game, "Alice", "Test Scout", "fisherman");
    equip(game, "Alice", "Test Repeat Equip", monkey);
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    useAbility(game, "Alice", monkey, "1"); // fisherman: deal 1 to an enemy

    expect(enemy.currentHp).toBe(20 - 2);
  });

  test("Yeon Yihwa cannot be targeted by a unit with Burned 3+", () => {
    const game = setupGameWithHands({ Alice: ["Test Hwayeomsa"], Bob: ["Test Scout"] });
    const yeon = deployUnit(game, "Alice", "Test Hwayeomsa", "fisherman");
    const attacker = deployUnit(game, "Bob", "Test Scout", "fisherman");

    game.modifierStack.apply({ sourceId: "System", sourceType: "system", targetId: attacker.id, type: "condition", key: "burned", value: 3 });

    const candidates = resolveTargets(game, { target: "enemy", sourceUnit: attacker, sourceOwner: "Bob" });
    expect(candidates.find((u) => u.id === yeon.id)).toBeUndefined();
  });

  test("Ice Spear makes the bearer's abilities give Frozen to their enemy target", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const monkey = deployUnit(game, "Alice", "Test Scout", "fisherman");
    equip(game, "Alice", "Test Modify Ability Equip", monkey);
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    useAbility(game, "Alice", monkey, "1");

    expect(game.modifierStack.has(enemy.id, "condition", "frozen")).toBe(true);
  });

  test("Wooden Horse loses 1 HP when any unit uses a Quick ability", () => {
    const game = setupGameWithHands({ Alice: ["Test Landmark Unit", "Test Scout"], Bob: [] });
    const horse = deployUnit(game, "Alice", "Test Landmark Unit", "landmark");
    const monkey = deployUnit(game, "Alice", "Test Scout", "scout");
    const beforeHp = horse.currentHp;

    useAbility(game, "Alice", monkey, "0"); // scout: quick: peek hand

    expect(horse.currentHp).toBe(beforeHp - 1);
  });

  test("Quaetro Blitz gives Burned 1 when Baang is played", () => {
    const game = setupGameWithHands({ Alice: ["Test Burn Passive Unit"], Bob: [] });
    deployUnit(game, "Alice", "Test Burn Passive Unit", "wave-controller");
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    putInHand(game, "Alice", "Test Damage Skill");
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const handId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Damage Skill");
    game.processAction({ type: "play-skill-action", data: { source: "player", username: "Alice", handId } });

    expect(game.modifierStack.has(enemy.id, "condition", "burned")).toBe(true);
  });

  test("an equipment's deal_damage triggered effect fires when the bearer deals damage", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const monkey = deployUnit(game, "Alice", "Test Scout", "fisherman");
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    const equipment = {
      id: "Equip#narumada",
      effects: [
        { type: "give_condition", condition: "exhausted", amount: 1, target: { side: "enemy" }, trigger: { type: "deal_damage" } },
      ],
    };
    LifecycleEngine._resolveEquipmentEffects(game, monkey, equipment);

    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: monkey.id, targetId: enemy.id, amount: 1 });

    expect(game.modifierStack.has(enemy.id, "condition", "exhausted")).toBe(true);
  });
});
