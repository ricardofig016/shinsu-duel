import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";
import { resolveEffect } from "../../EffectResolver.js";
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

  test("emits an observable event when an unregistered effect type is skipped", () => {
    const game = createGame();
    const events = [];
    game.eventBus.on(EVT.EFFECT_UNSUPPORTED, (payload) => events.push(payload));

    const result = resolveEffect(
      { type: "grant_affiliation", target: { side: "self" }, source: { side: "ally" }, raw: "grant an affiliation" },
      { emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) },
      game,
      { owner: "Alice", sourceId: "System" }
    );

    expect(result).toEqual(expect.objectContaining({ reason: "unsupported_effect" }));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ reason: "unsupported_effect", sourceId: "System" }),
    ]));
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

    const roundStart = manager._parseTrigger({
      type: "deal_damage", amount: 1, target: { side: "enemy" }, trigger: { type: "round_start" },
    });
    expect(roundStart.eventName).toBe(EVT.ROUND_START);
    expect(roundStart.effect.trigger).toEqual({ type: "round_start" });

    const roundEnd = manager._parseTrigger({
      type: "heal", amount: 1, target: { side: "self" }, trigger: { type: "round_end" },
    });
    expect(roundEnd.eventName).toBe(EVT.ROUND_END);

    expect(manager._parseTrigger({
      type: "modify_stat", stat: "damage", amount: 1, target: { side: "self" },
    })).toBeNull();
    expect(manager._parseTrigger({ type: "deal_damage", amount: 1 })).toBeNull();

    const skillPlayed = manager._parseTrigger({ trigger: { type: "skill_played", cardName: "Baang" } });
    expect(skillPlayed.eventName).toBe(EVT.SKILL_APPLIED);
    expect(skillPlayed.cardName).toBe("Baang");

    const dealDamage = manager._parseTrigger({ trigger: { type: "deal_damage" } });
    expect(dealDamage.eventName).toBe(EVT.DAMAGE_APPLIED);

    const quickAbility = manager._parseTrigger({ trigger: { type: "quick_ability_used" } });
    expect(quickAbility.eventName).toBe(EVT.UNIT_ABILITY_USED);
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
});
