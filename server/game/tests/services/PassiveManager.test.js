import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";
import { resolveEffect } from "../../EffectResolver.js";
import { jest } from "@jest/globals";
import { createLegalDeck, getCardIdByName, cards } from "../utils.js";

const players = ["Alice", "Bob"];

function createGame() {
  return new GameState("TEST", players, {
    Alice: createLegalDeck(),
    Bob: createLegalDeck(),
  }, null, { rng: new SeededRng(1), cards });
}

function putInHand(game, username, name) {
  const cardId = getCardIdByName(name);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  game.playerStates[username].hand.push(card);
  return card;
}

describe("PassiveManager", () => {
  test("runs a structured round-end passive while its source unit remains deployed", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const karaka = putInHand(game, "Alice", "Test Evolve Unit - Evolved");
    karaka.passiveAbilities = [{
      type: "deal_damage",
      amount: 3,
      target: "all_enemies",
      condition: "rooted",
      raw: "round end: deal 3 to all Rooted enemies",
      trigger: { type: "round_end" },
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(karaka);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "wave-controller");
    const targetCardId = getCardIdByName("Test Hwayeomsa");
    const targetCard = new Card(targetCardId, game.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#rooted-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);
    game.modifierStack.apply({
      sourceId: "System",
      sourceType: "system",
      targetId: target.id,
      type: "condition",
      key: "rooted",
      value: 1,
    });

    game.eventBus.emit(EVT.ROUND_END, { round: game.round });
    expect(target.currentHp).toBe(targetCard.maxHp - 3);

    LifecycleEngine.destroyUnit(game, unit);
    target.currentHp = targetCard.maxHp;
    game.eventBus.emit(EVT.ROUND_END, { round: game.round });
    expect(target.currentHp).toBe(targetCard.maxHp);
  });

  test("resolves a registered noop effect without error", () => {
    const game = createGame();
    const result = resolveEffect(
      { type: "noop", raw: "test" },
      { emitChild: () => {} },
      game,
      { owner: "Alice" }
    );

    expect(result).toEqual({ resolved: true });
  });

  test("always-on conditional passive applies on deploy and revokes when its predicate stops holding", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const urek = putInHand(game, "Alice", "Test Bearer Unit");
    urek.passiveAbilities = [{
      type: "conditional",
      if: { type: "alone_on_line", line: "frontline" },
      then: {
        type: "sequence",
        steps: [
          { type: "grant_trait", trait: "resilient", amount: 1, target: { side: "self" } },
          { type: "grant_trait", trait: "strong", amount: 3, target: { side: "self" } },
        ],
      },
      raw: "while i am alone on the ally frontline, i have Resilient 1 and Strong 3",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(urek);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    // Alone on the frontline on deploy → applied.
    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(1);
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(3);

    // A second allied unit enters the frontline → no longer alone → revoked.
    const ally = {
      id: "Unit#ally",
      owner: "Alice",
      card: { name: "Ally", maxHp: 5 },
      currentHp: 5,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(ally);
    game.eventBus.emit(EVT.UNIT_SUMMONED, { username: "Alice", unit: ally, unitId: ally.id });

    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(0);
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(0);
  });

  test("always-on re-evaluation does not recurse on its own grant events", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const bearer = putInHand(game, "Alice", "Test Bearer Unit");
    bearer.passiveAbilities = [{
      type: "conditional",
      if: { type: "alone_on_line", line: "frontline" },
      then: { type: "grant_trait", trait: "strong", amount: 2, target: { side: "self" } },
      raw: "while i am alone on the ally frontline, i have Strong 2",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(bearer);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    // Applying the passive grants Strong, which emits the modifier-granted
    // event the passive itself subscribes to. The per-source re-entrancy guard
    // stops that self-emission from re-triggering, so the grant lands exactly
    // once instead of recursing.
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(2);

    // A later re-evaluation (round start) re-applies idempotently.
    game.eventBus.emit(EVT.ROUND_START, { round: game.round });
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(2);
  });

  test("always-on conditional passive applies when its predicate becomes true mid-game", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const yuri = putInHand(game, "Alice", "Test Princess Unit");
    yuri.passiveAbilities = [{
      type: "conditional",
      if: { type: "has_unit", target: { side: "ally", name: "Guide" } },
      then: { type: "grant_trait", trait: "taunt", target: { side: "self" } },
      raw: "if i have an allied Guide, i have Taunt",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(yuri);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    // No allied Guide at deploy → no Taunt.
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(false);

    // An allied Guide enters play → Taunt applies.
    const guide = {
      id: "Unit#guide",
      owner: "Alice",
      card: { name: "Guide", maxHp: 5 },
      currentHp: 5,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(guide);
    game.eventBus.emit(EVT.UNIT_SUMMONED, { username: "Alice", unit: guide, unitId: guide.id });

    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(true);
  });

  test("_parseTrigger maps structured round triggers and skips unknown ones", () => {
    const game = createGame();
    const manager = game._passiveManager;
    const effect = { type: "deal_damage", amount: 1, target: { side: "enemy" } };

    const roundStart = manager._parseTrigger({ type: "round_start" }, effect);
    expect(roundStart.eventName).toBe(EVT.ROUND_START);
    expect(roundStart.effect).toBe(effect);
    expect(roundStart.type).toBe("round_start");

    const activation = manager._parseTrigger({ type: "activation" }, effect);
    expect(activation.eventName).toBe(EVT.ACTIVATION);
    expect(activation.type).toBe("activation");

    const roundEnd = manager._parseTrigger({ type: "round_end" }, { type: "heal", amount: 1, target: { side: "self" } });
    expect(roundEnd.eventName).toBe(EVT.ROUND_END);

    expect(manager._parseTrigger(undefined, effect)).toBeNull();
    expect(manager._parseTrigger({ type: "bogus" }, effect)).toBeNull();

    const skillPlayed = manager._parseTrigger({ type: "skill_played", cardName: "Baang" }, effect);
    expect(skillPlayed.eventName).toBe(EVT.SKILL_APPLIED);
    expect(skillPlayed.cardName).toBe("Baang");

    const dealDamage = manager._parseTrigger({ type: "deal_damage" }, effect);
    expect(dealDamage.eventName).toBe(EVT.DAMAGE_APPLIED);

    const quickAbility = manager._parseTrigger({ type: "quick_ability_used" }, effect);
    expect(quickAbility.eventName).toBe(EVT.UNIT_ABILITY_USED);

    const draw = manager._parseTrigger({ type: "draw", cardType: "equipment" }, effect);
    expect(draw.eventName).toBe(EVT.CARD_DRAWN);
    expect(draw.cardType).toBe("equipment");

    const reclaim = manager._parseTrigger({ type: "reclaim", cardType: "equipment" }, effect);
    expect(reclaim.eventName).toBe(EVT.CARD_RECLAIMED);
    expect(reclaim.cardType).toBe("equipment");

    const equip = manager._parseTrigger({ type: "equip", cardName: "Test Armor" }, effect);
    expect(equip.eventName).toBe(EVT.EQUIPMENT_ATTACHED);
    expect(equip.cardName).toBe("Test Armor");

    const dies = manager._parseTrigger({ type: "dies" }, effect);
    expect(dies.eventName).toBe(EVT.UNIT_KILLED);

    const allyDies = manager._parseTrigger({ type: "ally_dies", rank: "regular" }, effect);
    expect(allyDies.eventName).toBe(EVT.UNIT_KILLED);
    expect(allyDies.rank).toBe("regular");

    const freeAbility = manager._parseTrigger({ type: "free_ability_played" }, effect);
    expect(freeAbility.eventName).toBe(EVT.UNIT_ABILITY_USED);

    const evolve = manager._parseTrigger({ type: "evolve" }, effect);
    expect(evolve.eventName).toBe(EVT.UNIT_EVOLVING);
  });

  test("always-on conditional re-evaluates when an ally switches lines", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const urek = putInHand(game, "Alice", "Test Bearer Unit");
    urek.passiveAbilities = [{
      type: "conditional",
      if: { type: "alone_on_line", line: "frontline" },
      then: {
        type: "sequence",
        steps: [
          { type: "grant_trait", trait: "resilient", amount: 1, target: { side: "self" } },
          { type: "grant_trait", trait: "strong", amount: 3, target: { side: "self" } },
        ],
      },
      raw: "while i am alone on the ally frontline, i have Resilient 1 and Strong 3",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(urek);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(1);

    const ally = {
      id: "Unit#ally",
      owner: "Alice",
      card: { name: "Ally", maxHp: 5 },
      currentHp: 5,
      placedPositionCode: "light-bearer",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.backline.push(ally);

    // Switch into the frontline → no longer alone → revoked.
    game.playerStates.Alice.field.backline = game.playerStates.Alice.field.backline.filter((u) => u.id !== ally.id);
    game.playerStates.Alice.field.frontline.push(ally);
    game.eventBus.emit(EVT.UNIT_POSITION_SWITCHED, { username: "Alice", unit: ally, unitId: ally.id });
    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(0);
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(0);

    // Switch back out → alone again → re-applied.
    game.playerStates.Alice.field.frontline = game.playerStates.Alice.field.frontline.filter((u) => u.id !== ally.id);
    game.playerStates.Alice.field.backline.push(ally);
    game.eventBus.emit(EVT.UNIT_POSITION_SWITCHED, { username: "Alice", unit: ally, unitId: ally.id });
    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(1);
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(3);
  });

  test("always-on conditional with has_condition re-evaluates on condition changes", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const yuri = putInHand(game, "Alice", "Test Princess Unit");
    yuri.passiveAbilities = [{
      type: "conditional",
      if: { type: "has_condition", condition: "burned", target: { side: "enemy" } },
      then: { type: "grant_trait", trait: "taunt", target: { side: "self" } },
      raw: "if an enemy is Burned, i have Taunt",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(yuri);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(false);

    const enemy = {
      id: "Unit#enemy",
      owner: "Bob",
      card: { name: "Enemy", maxHp: 5 },
      currentHp: 5,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(enemy);

    game.modifierStack.apply({
      sourceId: "System",
      sourceType: "system",
      targetId: enemy.id,
      type: "condition",
      key: "burned",
      value: 1,
    });
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(true);

    game.modifierStack.removeWhere((m) => m.targetId === enemy.id && m.type === "condition");
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(false);
  });

  test("Disabled suppresses always-on modifier passives and re-applies on un-Disable", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const karaka = putInHand(game, "Alice", "Test Evolve Unit");
    karaka.passiveAbilities = [{
      type: "modify_keyword",
      keyword: "quick",
      target: { side: "self" },
      raw: "i have Quick",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(karaka);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    expect(game.modifierStack.getKeywords(unit, true).has("quick")).toBe(true);

    // Disabled turns passives off (RULES.md §Conditions) → the grant is revoked.
    game.modifierStack.apply({ sourceId: "System", sourceType: "system", targetId: unit.id, type: "condition", key: "disabled", value: 1 });
    expect(game.modifierStack.getKeywords(unit, true).has("quick")).toBe(false);

    // Un-Disable re-applies the always-on grant.
    game.modifierStack.removeWhere((m) => m.targetId === unit.id && m.type === "condition" && m.key === "disabled");
    expect(game.modifierStack.getKeywords(unit, true).has("quick")).toBe(true);
  });

  test("transformUnit revokes the outgoing card's always-on grants", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const urek = putInHand(game, "Alice", "Test Bearer Unit");
    urek.passiveAbilities = [{
      type: "conditional",
      if: { type: "alone_on_line", line: "frontline" },
      then: {
        type: "sequence",
        steps: [
          { type: "grant_trait", trait: "resilient", amount: 1, target: { side: "self" } },
          { type: "grant_trait", trait: "strong", amount: 3, target: { side: "self" } },
        ],
      },
      raw: "while i am alone on the ally frontline, i have Resilient 1 and Strong 3",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(urek);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(1);
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(3);

    LifecycleEngine.transformUnit(game, unit, getCardIdByName("Test Evolve Unit"));

    expect(game.modifierStack.getEffective(unit.id, "trait", "resilient")).toBe(0);
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(0);
    expect(unit.card.name).toBe("Test Evolve Unit");
  });

  test("destroyUnit revokes always-on grants the source holds on other units", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    const source = putInHand(game, "Alice", "Test Bearer Unit");
    source.passiveAbilities = [{
      type: "conditional",
      if: { type: "has_unit", target: { side: "ally", name: "Test Bearer Unit" } },
      then: { type: "grant_trait", trait: "strong", amount: 1, target: { side: "ally", scope: "all" } },
      raw: "while I'm on the field, allies have Strong 1",
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(source);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    expect(game.modifierStack.getEffective(unit.id, "trait", "strong")).toBe(1);

    // A second ally enters play → the source re-grants Strong to both.
    const ally = {
      id: "Unit#ally",
      owner: "Alice",
      card: { name: "Ally", maxHp: 5 },
      currentHp: 5,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(ally);
    game.eventBus.emit(EVT.UNIT_SUMMONED, { username: "Alice", unit: ally, unitId: ally.id });
    expect(game.modifierStack.getEffective(ally.id, "trait", "strong")).toBe(1);

    // Destroying the source must not leave its grant on the surviving ally.
    LifecycleEngine.destroyUnit(game, unit);
    expect(game.modifierStack.getEffective(ally.id, "trait", "strong")).toBe(0);
  });

  test("always-on has_equipped gate re-evaluates on detach against the post-detach state", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    const unitCard = putInHand(game, "Alice", "Test Bearer Unit");
    unitCard.passiveAbilities = [{
      type: "conditional",
      if: { type: "has_equipped", cardName: "Test Blue Thryssa" },
      then: { type: "grant_trait", trait: "taunt", target: { side: "self" } },
      raw: "while I have Blue Thryssa equipped, I have Taunt",
    }];
    const equip = putInHand(game, "Alice", "Test Blue Thryssa");

    const unitHandIndex = game.playerStates.Alice.hand.indexOf(unitCard);
    const { unit } = LifecycleEngine.deployUnit(game, "Alice", unitHandIndex, "fisherman");
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(false);

    // Attach → has_equipped becomes true → Taunt applied.
    const equipIdx = game.playerStates.Alice.hand.indexOf(equip);
    LifecycleEngine.attachEquipment(game, "Alice", equipIdx, unit);
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(true);

    // Detach → always-on re-evaluation must read the post-detach state and revoke.
    LifecycleEngine.detachEquipment(game, unit, equip);
    expect(game.modifierStack.has(unit.id, "trait", "taunt")).toBe(false);
  });

  test("summon passive fires on the owner's matching-kind summon", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const nare = putInHand(game, "Alice", "Test Scout");
    nare.passiveAbilities = [{
      type: "deal_damage",
      amount: 1,
      target: "all_enemies",
      raw: "when you summon a Shinheuh, deal 1 to all enemies",
      trigger: { type: "summon", source: "shinheuh" },
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(nare);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "scout");

    const targetCardId = getCardIdByName("Test Hwayeomsa");
    const targetCard = new Card(targetCardId, game.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#summon-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);

    const shinheuh = {
      id: "Unit#shinheuh",
      owner: "Alice",
      card: { name: "Bull", kind: "shinheuh", maxHp: 3 },
      currentHp: 3,
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(shinheuh);
    game.eventBus.emit(EVT.UNIT_SUMMONED, { username: "Alice", unit: shinheuh, unitId: shinheuh.id });

    expect(target.currentHp).toBe(targetCard.maxHp - 1);
  });

  test("summon passive ignores a non-matching kind and other owners' summons", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const nare = putInHand(game, "Alice", "Test Scout");
    nare.passiveAbilities = [{
      type: "deal_damage",
      amount: 1,
      target: "all_enemies",
      raw: "when you summon a Shinheuh, deal 1 to all enemies",
      trigger: { type: "summon", source: "shinheuh" },
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(nare);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "scout");

    const targetCardId = getCardIdByName("Test Hwayeomsa");
    const targetCard = new Card(targetCardId, game.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#summon-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);

    // A standard-kind summon does not match `source: shinheuh`.
    const standard = {
      id: "Unit#standard",
      owner: "Alice",
      card: { name: "Standard", kind: "standard", maxHp: 3 },
      currentHp: 3,
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(standard);
    game.eventBus.emit(EVT.UNIT_SUMMONED, { username: "Alice", unit: standard, unitId: standard.id });
    expect(target.currentHp).toBe(targetCard.maxHp);

    // A shinheuh summoned by the opponent does not fire the passive.
    const oppShinheuh = {
      id: "Unit#opp-shinheuh",
      owner: "Bob",
      card: { name: "Bull", kind: "shinheuh", maxHp: 3 },
      currentHp: 3,
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(oppShinheuh);
    game.eventBus.emit(EVT.UNIT_SUMMONED, { username: "Bob", unit: oppShinheuh, unitId: oppShinheuh.id });
    expect(target.currentHp).toBe(targetCard.maxHp);
  });

  test("deploy passive fires on the unit's own deployment only", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    const targetCardId = getCardIdByName("Test Hwayeomsa");
    const targetCard = new Card(targetCardId, game.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#deploy-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);

    const card = putInHand(game, "Alice", "Test Scout");
    card.passiveAbilities = [{
      type: "deal_damage",
      amount: 1,
      target: "all_enemies",
      raw: "when i am deployed, deal 1 to all enemies",
      trigger: { type: "deploy" },
    }];

    const handIndex = game.playerStates.Alice.hand.indexOf(card);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "scout");
    expect(target.currentHp).toBe(targetCard.maxHp - 1);

    // Deploying a different unit must not re-fire this unit's deploy passive.
    const other = putInHand(game, "Alice", "Test Fisherman Unit");
    const otherIdx = game.playerStates.Alice.hand.indexOf(other);
    LifecycleEngine.deployUnit(game, "Alice", otherIdx, "fisherman");
    expect(target.currentHp).toBe(targetCard.maxHp - 1);
  });

  test("a triggers-array passive fires on ROUND_START for every owner and on ACTIVATION only for the matching unit", () => {
    const game = createGame();
    game.round = 10;

    const passive = {
      type: "deal_damage",
      amount: 1,
      target: "all_enemies",
      raw: "round start or activation: deal 1 to all enemies",
      triggers: [{ type: "round_start" }, { type: "activation" }],
    };
    const makeUnit = (id) => ({
      id,
      owner: "Alice",
      card: { name: "Conduit", maxHp: 8, passiveAbilities: [passive] },
      currentHp: 8,
      placedPositionCode: "backline",
      isAlive() { return this.currentHp > 0; },
    });
    const unitA = makeUnit("Unit#rsa-a");
    const unitB = makeUnit("Unit#rsa-b");
    game.playerStates.Alice.field.backline.push(unitA, unitB);
    game._passiveManager.registerUnit(unitA, game);
    game._passiveManager.registerUnit(unitB, game);

    const targetCardId = getCardIdByName("Test Hwayeomsa");
    const targetCard = new Card(targetCardId, game.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#rsa-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);

    // ROUND_START carries no unitId, so every owner's passive fires (2 damage).
    game.eventBus.emit(EVT.ROUND_START, { round: game.round });
    expect(target.currentHp).toBe(targetCard.maxHp - 2);

    // ACTIVATION carries the activated unit's id, so only that owner fires.
    target.currentHp = targetCard.maxHp;
    game.eventBus.emit(EVT.ACTIVATION, { unitId: unitA.id, unit: unitA, username: "Alice" });
    expect(target.currentHp).toBe(targetCard.maxHp - 1);

    // An ACTIVATION whose unitId matches neither owner fires nothing.
    target.currentHp = targetCard.maxHp;
    game.eventBus.emit(EVT.ACTIVATION, { unitId: "Unit#someone-else", unit: null, username: "Alice" });
    expect(target.currentHp).toBe(targetCard.maxHp);
  });

  test("a triggers-array passive's subscriptions are torn down when the unit leaves the field", () => {
    const game = createGame();
    game.round = 10;

    const unit = {
      id: "Unit#rsa-cleanup",
      owner: "Alice",
      card: {
        name: "Conduit",
        maxHp: 8,
        passiveAbilities: [{
          type: "deal_damage",
          amount: 1,
          target: "all_enemies",
          raw: "round start or activation: deal 1 to all enemies",
          triggers: [{ type: "round_start" }, { type: "activation" }],
        }],
      },
      currentHp: 8,
      placedPositionCode: "backline",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.backline.push(unit);
    game._passiveManager.registerUnit(unit, game);

    const targetCardId = getCardIdByName("Test Hwayeomsa");
    const targetCard = new Card(targetCardId, game.cards[targetCardId], "Bob", game.eventBus);
    const target = {
      id: "Unit#rsa-cleanup-target",
      owner: "Bob",
      card: targetCard,
      currentHp: targetCard.maxHp,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(target);

    // Both subscriptions are live before cleanup.
    game.eventBus.emit(EVT.ACTIVATION, { unitId: unit.id, unit, username: "Alice" });
    expect(target.currentHp).toBe(targetCard.maxHp - 1);

    // Unregistering must remove both the ROUND_START and ACTIVATION subscriptions.
    game._passiveManager.unregisterUnit(unit.id);
    target.currentHp = targetCard.maxHp;
    game.eventBus.emit(EVT.ROUND_START, { round: game.round });
    game.eventBus.emit(EVT.ACTIVATION, { unitId: unit.id, unit, username: "Alice" });
    expect(target.currentHp).toBe(targetCard.maxHp);
  });

  test("a conditional passive with triggers is event-driven, not treated as always-on by reapplyAll", () => {
    const game = createGame();
    game.round = 10;

    const unit = {
      id: "Unit#rsa-conditional",
      owner: "Alice",
      card: {
        name: "Conduit",
        maxHp: 8,
        passiveAbilities: [{
          type: "conditional",
          triggers: [{ type: "round_start" }, { type: "activation" }],
          if: { type: "has_unit", target: { side: "enemy", attribute: "jeonsulsa" }, negate: true },
          then: { type: "slay", target: { side: "self" } },
          raw: "round start or activation: if no enemy Jeonsulsa, Slay me",
        }],
      },
      currentHp: 8,
      placedPositionCode: "backline",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.backline.push(unit);
    game._passiveManager.registerUnit(unit, game);

    // reapplyAll must skip a triggers-based conditional: it is event-driven,
    // not an always-on passive that re-evaluates on every board event.
    const applySpy = jest.spyOn(game._passiveManager, "_applyAlwaysOn");
    game._passiveManager.reapplyAll(game);
    expect(applySpy).not.toHaveBeenCalled();
  });

  test("a triggers-array passive subscribes each trigger at execute phase priority -100", () => {
    const game = createGame();
    game.round = 10;

    const unit = {
      id: "Unit#rsa-phases",
      owner: "Alice",
      card: {
        name: "Conduit",
        maxHp: 8,
        passiveAbilities: [{
          type: "deal_damage",
          amount: 1,
          target: "all_enemies",
          raw: "round start or activation: deal 1 to all enemies",
          triggers: [{ type: "round_start" }, { type: "activation" }],
        }],
      },
      currentHp: 8,
      placedPositionCode: "backline",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.backline.push(unit);

    const onSpy = jest.spyOn(game.eventBus, "on");
    game._passiveManager.registerUnit(unit, game);

    const triggerSubscriptions = onSpy.mock.calls.filter(
      ([eventName]) => eventName === EVT.ROUND_START || eventName === EVT.ACTIVATION
    );
    // Each trigger is wired independently to its own event, in passive order.
    expect(triggerSubscriptions.map(([eventName]) => eventName)).toEqual([EVT.ROUND_START, EVT.ACTIVATION]);
    for (const [, , options] of triggerSubscriptions) {
      expect(options).toEqual({ phase: "execute", priority: -100 });
    }
    onSpy.mockRestore();
  });

  test("the newly wired triggers subscribe their own events at execute phase priority -100", () => {
    const game = createGame();
    game.round = 10;

    const unit = {
      id: "Unit#wired-phases",
      owner: "Alice",
      card: {
        name: "Evan-shaped",
        maxHp: 3,
        passiveAbilities: [{
          type: "draw_card",
          amount: 1,
          raw: "on death, evolve, or equipment draw: draw 1",
          triggers: [{ type: "dies" }, { type: "evolve" }, { type: "draw", cardType: "equipment" }],
        }],
      },
      currentHp: 3,
      placedPositionCode: "scout",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(unit);

    const onSpy = jest.spyOn(game.eventBus, "on");
    game._passiveManager.registerUnit(unit, game);

    const triggerSubscriptions = onSpy.mock.calls.filter(
      ([eventName]) => eventName === EVT.UNIT_KILLED || eventName === EVT.UNIT_EVOLVING || eventName === EVT.CARD_DRAWN
    );
    expect(triggerSubscriptions.map(([eventName]) => eventName)).toEqual([EVT.UNIT_KILLED, EVT.UNIT_EVOLVING, EVT.CARD_DRAWN]);
    for (const [, , options] of triggerSubscriptions) {
      expect(options).toEqual({ phase: "execute", priority: -100 });
    }
    onSpy.mockRestore();
  });

  test("draw passive fires for the owner's equipment draws and chains through its own draw", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const evan = putInHand(game, "Alice", "Test Scout");
    evan.passiveAbilities = [{
      type: "draw_card",
      amount: 1,
      raw: "whenever you draw an equipment, draw again",
      trigger: { type: "draw", cardType: "equipment" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(evan);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "scout");

    // Deck top (array end): a filler under an equipment, so the passive's own
    // draw pulls the filler and the chain stops on the non-equipment draw.
    const armorId = getCardIdByName("Test Armor");
    const fillerId = getCardIdByName("Test Filler 1");
    const filler = new Card(fillerId, game.cards[fillerId], "Alice", game.eventBus);
    const armor = new Card(armorId, game.cards[armorId], "Alice", game.eventBus);
    game.playerStates.Alice.deck.push(filler, armor);

    const handSize = game.playerStates.Alice.hand.length;
    game.eventBus.emit(EVT.CARD_DRAWN, { owner: "Alice", cardId: armor.cardId, cardName: armor.name, card: armor });

    expect(game.playerStates.Alice.hand).toContain(armor);
    expect(game.playerStates.Alice.hand).toContain(filler);
    expect(game.playerStates.Alice.hand.length).toBe(handSize + 2);
  });

  test("draw passive ignores other owners' draws and non-matching card types", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const evan = putInHand(game, "Alice", "Test Scout");
    evan.passiveAbilities = [{
      type: "draw_card",
      amount: 1,
      raw: "whenever you draw an equipment, draw again",
      trigger: { type: "draw", cardType: "equipment" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(evan);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "scout");

    const fillerId = getCardIdByName("Test Filler 1");
    const filler = new Card(fillerId, game.cards[fillerId], "Alice", game.eventBus);
    const bobArmorId = getCardIdByName("Test Armor");
    const bobArmor = new Card(bobArmorId, game.cards[bobArmorId], "Bob", game.eventBus);
    game.playerStates.Alice.deck.push(filler);

    const handSize = game.playerStates.Alice.hand.length;
    const deckSize = game.playerStates.Alice.deck.length;

    // Another player's equipment draw does not fire the passive.
    game.eventBus.emit(EVT.CARD_DRAWN, { owner: "Bob", cardId: bobArmor.cardId, cardName: bobArmor.name, card: bobArmor });
    // The owner's non-equipment draw does not fire it either.
    game.eventBus.emit(EVT.CARD_DRAWN, { owner: "Alice", cardId: filler.cardId, cardName: filler.name, card: filler });

    expect(game.playerStates.Alice.hand.length).toBe(handSize);
    expect(game.playerStates.Alice.deck.length).toBe(deckSize);
  });

  test("reclaim passive compresses the reclaimed card itself, not other hand cards", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const kurudan = putInHand(game, "Alice", "Test Scout");
    kurudan.passiveAbilities = [{
      type: "compress_shinsu",
      amount: 1,
      card: { type: "equipment" },
      raw: "when you reclaim an equipment, Compress 1 from it",
      trigger: { type: "reclaim", cardType: "equipment" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(kurudan);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    // A second equipment sits in hand: precise threading must leave it alone.
    const armor = putInHand(game, "Alice", "Test Armor");
    const fillerEquipId = getCardIdByName("Test Equipment Filler");
    const reclaimed = new Card(fillerEquipId, game.cards[fillerEquipId], "Alice", game.eventBus);
    game.playerStates.Alice.hand.push(reclaimed);

    game.eventBus.emit(EVT.CARD_RECLAIMED, { owner: "Alice", cardId: reclaimed.cardId, cardName: reclaimed.name, card: reclaimed });

    expect(reclaimed.costReduction).toBe(1);
    expect(armor.costReduction).toBe(0);
  });

  test("reclaim passive ignores other owners and non-equipment reclaims", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const kurudan = putInHand(game, "Alice", "Test Scout");
    kurudan.passiveAbilities = [{
      type: "compress_shinsu",
      amount: 1,
      card: { type: "equipment" },
      raw: "when you reclaim an equipment, Compress 1 from it",
      trigger: { type: "reclaim", cardType: "equipment" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(kurudan);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    const armor = putInHand(game, "Alice", "Test Armor");
    const fillerId = getCardIdByName("Test Filler 1");
    const unitCard = new Card(fillerId, game.cards[fillerId], "Alice", game.eventBus);
    const bobArmor = new Card(getCardIdByName("Test Armor"), game.cards[getCardIdByName("Test Armor")], "Bob", game.eventBus);

    game.eventBus.emit(EVT.CARD_RECLAIMED, { owner: "Bob", cardId: bobArmor.cardId, cardName: bobArmor.name, card: bobArmor });
    game.eventBus.emit(EVT.CARD_RECLAIMED, { owner: "Alice", cardId: unitCard.cardId, cardName: unitCard.name, card: unitCard });

    expect(armor.costReduction).toBe(0);
  });

  test("equip passive fires when its named equipment is attached to the bearer", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const bearerCard = putInHand(game, "Alice", "Test Scout");
    bearerCard.passiveAbilities = [{
      type: "reclaim_cards",
      amount: 1,
      card: { type: "equipment" },
      raw: "when i'm equipped with Test Armor, Reclaim 1 Equipment card",
      trigger: { type: "equip", cardName: "Test Armor" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(bearerCard);
    const { unit: bearer } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    const armor = putInHand(game, "Alice", "Test Armor");
    const fillerEquipId = getCardIdByName("Test Equipment Filler");
    game.playerStates.Alice.discard.push(new Card(fillerEquipId, game.cards[fillerEquipId], "Alice", game.eventBus));

    const equipIdx = game.playerStates.Alice.hand.indexOf(armor);
    LifecycleEngine.attachEquipment(game, "Alice", equipIdx, bearer);

    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Equipment Filler")).toBe(true);
  });

  test("equip passive ignores a different equipment name and other bearers", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const bearerCard = putInHand(game, "Alice", "Test Scout");
    bearerCard.passiveAbilities = [{
      type: "reclaim_cards",
      amount: 1,
      card: { type: "equipment" },
      raw: "when i'm equipped with Test Armor, Reclaim 1 Equipment card",
      trigger: { type: "equip", cardName: "Test Armor" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(bearerCard);
    const { unit: bearer } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");

    const fillerEquipId = getCardIdByName("Test Equipment Filler");
    game.playerStates.Alice.discard.push(new Card(fillerEquipId, game.cards[fillerEquipId], "Alice", game.eventBus));
    const discardSize = game.playerStates.Alice.discard.length;

    // A different equipment name does not match the authored cardName.
    const thryssa = putInHand(game, "Alice", "Test Blue Thryssa");
    const thryssaIdx = game.playerStates.Alice.hand.indexOf(thryssa);
    LifecycleEngine.attachEquipment(game, "Alice", thryssaIdx, bearer);
    expect(game.playerStates.Alice.discard.length).toBe(discardSize);

    // Another bearer's attach does not fire it either.
    game.eventBus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#someone-else", equipment: thryssa, sourceId: thryssa.id });
    expect(game.playerStates.Alice.discard.length).toBe(discardSize);
  });

  test("a unit's own dies passive fires at unit:killed while it is still subscribed", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const appleCard = putInHand(game, "Alice", "Test Scout");
    appleCard.passiveAbilities = [{
      type: "light_up",
      amount: 1,
      raw: "when i die, Light Up 1",
      trigger: { type: "dies" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(appleCard);
    const { unit: apple } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    const before = game.playerStates.Alice.lighthouses.amount;

    // Lethal damage has already brought the unit to 0 HP when unit:killed
    // emits; the death passives must still fire through the real pipeline.
    apple.currentHp = 0;
    LifecycleEngine.killUnit(game, apple, { sourceId: "Unit#killer", sourceOwner: "Bob" });

    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 1);
    expect(game._findUnit(apple.id)).toBeNull();
  });

  test("dies passives do not fire for other units' deaths or for non-death removals", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const watcher = putInHand(game, "Alice", "Test Scout");
    watcher.passiveAbilities = [{
      type: "light_up",
      amount: 1,
      raw: "when i die, Light Up 1",
      trigger: { type: "dies" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(watcher);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    const before = game.playerStates.Alice.lighthouses.amount;

    // Another unit's death is not this unit's death.
    game.eventBus.emit(EVT.UNIT_KILLED, { sourceId: "Unit#killer", targetId: "Unit#other", killerId: "Unit#killer", killerOwner: "Bob", owner: "Bob" });
    // Substitution-style destroys never announce a death at all, and the
    // passive is wired to unit:killed only.
    game.eventBus.emit(EVT.UNIT_DESTROYED, { unitId: watcher.id, unit: watcher, owner: "Alice" });

    expect(game.playerStates.Alice.lighthouses.amount).toBe(before);
  });

  test("ally_dies fires for an allied Regular's death and for the unit's own death", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const watcherCard = putInHand(game, "Alice", "Test Scout");
    watcherCard.passiveAbilities = [{
      type: "light_up",
      amount: 1,
      raw: "when an ally Regular dies: Light Up 1",
      trigger: { type: "ally_dies", rank: "regular" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(watcherCard);
    const { unit: watcher } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    const before = game.playerStates.Alice.lighthouses.amount;

    // An allied Regular dies.
    const fillerId = getCardIdByName("Test Filler 1");
    const ally = new Card(fillerId, game.cards[fillerId], "Alice", game.eventBus);
    const allyUnit = {
      id: "Unit#ally-regular",
      owner: "Alice",
      card: ally,
      currentHp: 0,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(allyUnit);
    LifecycleEngine.killUnit(game, allyUnit, { sourceId: "Unit#killer", sourceOwner: "Bob" });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 1);

    // The watcher's own death is an ally death too (RULES.md ally definition).
    watcher.currentHp = 0;
    LifecycleEngine.killUnit(game, watcher, { sourceId: "Unit#killer", sourceOwner: "Bob" });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 2);
  });

  test("ally_dies ignores enemies and rank mismatches", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const watcher = putInHand(game, "Alice", "Test Scout");
    watcher.passiveAbilities = [{
      type: "light_up",
      amount: 1,
      raw: "when an ally Regular dies: Light Up 1",
      trigger: { type: "ally_dies", rank: "regular" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(watcher);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    const before = game.playerStates.Alice.lighthouses.amount;

    // An enemy Regular's death does not fire it.
    const fillerId = getCardIdByName("Test Filler 1");
    const enemy = new Card(fillerId, game.cards[fillerId], "Bob", game.eventBus);
    const enemyUnit = {
      id: "Unit#enemy-regular",
      owner: "Bob",
      card: enemy,
      currentHp: 0,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Bob.field.frontline.push(enemyUnit);
    LifecycleEngine.killUnit(game, enemyUnit, { sourceId: "Unit#killer", sourceOwner: "Alice" });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before);

    // A high-ranker ally's death does not match the authored rank.
    const highRankerId = getCardIdByName("Test Evolve Unit");
    const highRanker = new Card(highRankerId, game.cards[highRankerId], "Alice", game.eventBus);
    const highRankerUnit = {
      id: "Unit#ally-high-ranker",
      owner: "Alice",
      card: highRanker,
      currentHp: 0,
      placedPositionCode: "fisherman",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.frontline.push(highRankerUnit);
    LifecycleEngine.killUnit(game, highRankerUnit, { sourceId: "Unit#killer", sourceOwner: "Bob" });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before);
  });

  test("free_ability_played extinguishes the ability user's own lighthouses", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const landmarkBearer = putInHand(game, "Alice", "Test Scout");
    landmarkBearer.passiveAbilities = [{
      type: "extinguish",
      amount: 5,
      owner: "self",
      raw: "when an ability with Free is played, the unit Extinguishes 5 of their own lighthouses",
      trigger: { type: "free_ability_played" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(landmarkBearer);
    LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    const aliceBefore = game.playerStates.Alice.lighthouses.amount;
    const bobBefore = game.playerStates.Bob.lighthouses.amount;

    game.eventBus.emit(EVT.UNIT_ABILITY_USED, { username: "Bob", unitId: "Unit#free-user", abilityCode: "0", quick: false, free: true });
    expect(game.playerStates.Bob.lighthouses.amount).toBe(bobBefore - 5);
    expect(game.playerStates.Alice.lighthouses.amount).toBe(aliceBefore);

    // A non-Free ability use does not fire the passive.
    game.eventBus.emit(EVT.UNIT_ABILITY_USED, { username: "Alice", unitId: "Unit#not-free", abilityCode: "0", quick: false, free: false });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(aliceBefore);
  });

  test("an evolve passive fires on the unit's own evolution announcement", () => {
    const game = createGame();
    game.round = 10;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };
    const betaCard = putInHand(game, "Alice", "Test Scout");
    betaCard.passiveAbilities = [{
      type: "create_card",
      card: { name: "Test Filler 1" },
      raw: "when i evolve: create Test Filler 1 in hand",
      trigger: { type: "evolve" },
    }];
    const handIndex = game.playerStates.Alice.hand.indexOf(betaCard);
    const { unit: beta } = LifecycleEngine.deployUnit(game, "Alice", handIndex, "fisherman");
    const handSize = game.playerStates.Alice.hand.length;

    game.eventBus.emit(EVT.UNIT_EVOLVING, { unitId: beta.id, unit: beta, toCardId: getCardIdByName("Test Evolve Unit") });
    expect(game.playerStates.Alice.hand.length).toBe(handSize + 1);

    // Another unit's evolution does not fire this passive.
    game.eventBus.emit(EVT.UNIT_EVOLVING, { unitId: "Unit#other", unit: null, toCardId: getCardIdByName("Test Evolve Unit") });
    expect(game.playerStates.Alice.hand.length).toBe(handSize + 1);
  });

  test("death and evolution subscriptions are torn down when the unit is unregistered", () => {
    const game = createGame();
    game.round = 10;

    const unit = {
      id: "Unit#death-cleanup",
      owner: "Alice",
      card: {
        name: "Conduit",
        maxHp: 8,
        passiveAbilities: [{
          type: "light_up",
          amount: 1,
          raw: "when i die or evolve: Light Up 1",
          triggers: [{ type: "dies" }, { type: "evolve" }],
        }],
      },
      currentHp: 0,
      placedPositionCode: "backline",
      isAlive() { return this.currentHp > 0; },
    };
    game.playerStates.Alice.field.backline.push(unit);
    game._passiveManager.registerUnit(unit, game);

    const before = game.playerStates.Alice.lighthouses.amount;
    game.eventBus.emit(EVT.UNIT_KILLED, { sourceId: "Unit#killer", targetId: unit.id, killerId: "Unit#killer", killerOwner: "Bob", owner: "Alice" });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 1);

    game._passiveManager.unregisterUnit(unit.id);
    game.eventBus.emit(EVT.UNIT_KILLED, { sourceId: "Unit#killer", targetId: unit.id, killerId: "Unit#killer", killerOwner: "Bob", owner: "Alice" });
    game.eventBus.emit(EVT.UNIT_EVOLVING, { unitId: unit.id, unit, toCardId: getCardIdByName("Test Evolve Unit") });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 1);
  });
});
