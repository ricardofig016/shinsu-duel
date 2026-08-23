import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import ModifierService from "../../services/ModifierService.js";
import * as IdFactory from "../../IdFactory.js";
import { resetModifierCounter } from "../../ModifierStack.js";
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

  test("a modify_ability augment applies once per target across a multi-step ability", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const monkey = deployUnit(game, "Alice", "Test Scout", "fisherman");
    equip(game, "Alice", "Test Modify Ability Equip", monkey);
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    // A sequence that targets the same enemy in two steps must not stack the
    // augment (Frozen) once per step.
    monkey.card.abilities = [{
      type: "sequence",
      steps: [
        { type: "deal_damage", amount: 1, target: { side: "enemy" } },
        { type: "deal_damage", amount: 1, target: { side: "enemy" } },
      ],
      raw: "deal 1 to an enemy, twice",
    }];

    useAbility(game, "Alice", monkey, "0");

    expect(game.modifierStack.getEffective(enemy.id, "condition", "frozen")).toBe(1);
  });

  test("modify_repeat re-arms modify_ability augments once per trigger", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const monkey = deployUnit(game, "Alice", "Test Scout", "fisherman");
    const enemy = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    // A bearer with both `modify_repeat` 2 and an Ice-Spear-style augment:
    // each of the two triggers is a fresh use, so Frozen applies once each.
    const equipment = {
      id: "Equip#combo",
      effects: [
        { type: "modify_repeat", amount: 2, target: { side: "bearer" } },
        { type: "modify_ability", target: { side: "bearer" }, effect: { type: "give_condition", condition: "frozen", amount: 1, target: { side: "enemy" } } },
      ],
    };
    LifecycleEngine._resolveEquipmentEffects(game, monkey, equipment);

    useAbility(game, "Alice", monkey, "1"); // deal 1 to an enemy, twice

    expect(enemy.currentHp).toBe(20 - 2); // 2 triggers
    expect(game.modifierStack.getEffective(enemy.id, "condition", "frozen")).toBe(2); // once per trigger
  });

  test("Wooden Horse loses 1 HP when any unit uses a Quick ability", () => {
    const game = setupGameWithHands({ Alice: ["Test Landmark Unit", "Test Scout"], Bob: [] });
    const horse = deployUnit(game, "Alice", "Test Landmark Unit", "backline");
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

  test("Stone Doll takes +4 damage from Spear Bearers (damage_taken source filter)", () => {
    const game = setupGameWithHands({ Alice: ["Test Spear Bearer"], Bob: ["Test Stone Doll"] });
    const spear = deployUnit(game, "Alice", "Test Spear Bearer", "spear-bearer");
    const stoneDoll = deployUnit(game, "Bob", "Test Stone Doll", "fisherman");

    useAbility(game, "Alice", spear, "0"); // deal 4 to an enemy

    expect(stoneDoll.currentHp).toBe(20 - 8); // 4 base + 4 damage_taken
  });

  test("Pedro gives Poisoned +2 to High Ranker units while equipped", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout Ranker"], Bob: ["Test Backline High Ranker"] });
    const pedro = deployUnit(game, "Alice", "Test Scout Ranker", "scout");
    equip(game, "Alice", "Test Grant Ability Equip", pedro);
    const highRanker = deployUnit(game, "Bob", "Test Backline High Ranker", "spear-bearer");

    useAbility(game, "Alice", pedro, "0"); // give Poisoned 1 to a backline enemy

    expect(game.modifierStack.getEffective(highRanker.id, "condition", "poisoned")).toBe(3);
  });

  test("Hwa Ryun raises enemy skill costs and Yeo Goseng lowers ally team-sweet-and-sour costs", () => {
    const game = setupGameWithHands({ Alice: ["Test Yeo Goseng"], Bob: ["Test Hwa Ryun"] });
    deployUnit(game, "Alice", "Test Yeo Goseng", "light-bearer");
    deployUnit(game, "Bob", "Test Hwa Ryun", "scout");

    // Yeo Goseng (Alice): team-sweet-and-sour allies cost 1 less.
    const yeoCard = new Card(getCardIdByName("Test Yeo Goseng"), game.cards[getCardIdByName("Test Yeo Goseng")], "Alice", game.eventBus);
    expect(ModifierService.getEffectiveCost(yeoCard, "Alice", game)).toBe(0);

    // Hwa Ryun (Bob): Alice's skills cost 1 more (ally team-baam/team-fug = Hwa Ryun itself).
    const skillCard = new Card(getCardIdByName("Test Poison Skill"), game.cards[getCardIdByName("Test Poison Skill")], "Alice", game.eventBus);
    expect(ModifierService.getEffectiveCost(skillCard, "Alice", game)).toBe(skillCard.cost + 1);
  });

  test("Novick disarms the specific enemy it damaged", () => {
    const game = setupGameWithHands({ Alice: ["Test Novick"], Bob: ["Test Princess Unit"] });
    const novick = deployUnit(game, "Alice", "Test Novick", "spear-bearer");
    const princess = deployUnit(game, "Bob", "Test Princess Unit", "fisherman");
    equip(game, "Bob", "Test Blue Thryssa", princess);
    expect(princess.equipmentAttachments).toHaveLength(1);

    useAbility(game, "Alice", novick, "0"); // spear bearer: deal 7 to an enemy

    expect(princess.equipmentAttachments).toHaveLength(0); // disarmed
    expect(princess.isAlive()).toBe(true); // survived (8 hp, Resilient 3)
  });

  test("Wooden Horse charges the ability user (even an enemy) and still loses 1 HP", () => {
    const game = setupGameWithHands({ Alice: ["Test Landmark Unit"], Bob: ["Test Scout"] });
    const horse = deployUnit(game, "Alice", "Test Landmark Unit", "backline");
    const monkey = deployUnit(game, "Bob", "Test Scout", "scout");
    const beforeHp = horse.currentHp;
    game.currentTurn = "Bob";
    game.playerStates.Bob.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };

    game.processAction({ type: "use-ability-action", data: { source: "player", username: "Bob", unitId: monkey.id, abilityCode: "0" } });

    expect(game.playerStates.Bob.shinsu.normalAvailable).toBe(6); // the ability user Charges 1
    expect(game.playerStates.Alice.shinsu.normalAvailable).toBe(5); // the landmark owner does not Charge
    expect(horse.currentHp).toBe(beforeHp - 1); // Wooden Horse loses 1 HP
  });

  test("Quaetro Blitz does not trigger on an enemy's skill play", () => {
    const game = setupGameWithHands({ Alice: ["Test Burn Passive Unit"], Bob: ["Test Damage Skill"] });
    deployUnit(game, "Alice", "Test Burn Passive Unit", "wave-controller");
    const ally = stubUnit(game, "Bob", "Test Fisherman Unit", "fisherman", 20);

    game.currentTurn = "Bob";
    game.playerStates.Bob.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const handId = game.playerStates.Bob.hand.findIndex((c) => c.name === "Test Damage Skill");
    game.processAction({ type: "play-skill-action", data: { source: "player", username: "Bob", handId } });

    expect(game.modifierStack.has(ally.id, "condition", "burned")).toBe(false);
  });

  test("equipping a quick_ability_used trigger equipment does not throw and charges the bearer's owner", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: [] });
    const monkey = deployUnit(game, "Alice", "Test Scout", "scout");

    expect(() => equip(game, "Alice", "Test Dionysos Wings", monkey)).not.toThrow();
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };

    game.processAction({ type: "use-ability-action", data: { source: "player", username: "Alice", unitId: monkey.id, abilityCode: "0" } });

    expect(game.playerStates.Alice.shinsu.normalAvailable).toBe(6); // the bearer's Quick ability Charged 1
  });

  test("modify_repeat + random targeting is deterministic under a fixed seed", () => {
    const run = () => {
      IdFactory.resetAll();
      resetModifierCounter();
      const game = setupGameWithHands({
        Alice: ["Test Random Target Unit"],
        Bob: ["Test Filler 1", "Test Filler 2", "Test Filler 3"],
      });
      const unit = deployUnit(game, "Alice", "Test Random Target Unit", "fisherman");
      deployUnit(game, "Bob", "Test Filler 1", "fisherman");
      deployUnit(game, "Bob", "Test Filler 2", "fisherman");
      deployUnit(game, "Bob", "Test Filler 3", "fisherman");
      equip(game, "Alice", "Test Repeat Equip", unit);
      useAbility(game, "Alice", unit, "0"); // deal 1 to a random enemy (x2 via repeat)
      return game.toSerializedState();
    };

    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});
