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

  test("a landmark position choice resolver is a no-op once the landmark left play", () => {
    const game = createGame();
    const decisions = [];
    game.createPendingDecision = (opts) => { decisions.push(opts); };
    const landmarkCardId = getCardIdByName("Test Name Hunt Station");
    const unit = {
      id: "Unit#stale-landmark",
      owner: "Alice",
      chosenPositionCode: null,
      isAlive: () => true,
      card: new Card(landmarkCardId, game.cards[landmarkCardId], "Alice", game.eventBus),
    };
    const registry = { registerUnit: jest.fn(), reconcile: jest.fn() };
    game._globalRuleRegistry = registry;
    game._findUnit = () => null; // the landmark is off the field

    game._passiveManager._choosePosition(unit, game);
    expect(decisions).toHaveLength(1);
    decisions[0].resolve(["scout"]);

    // The stale resolution must not store a choice or re-register rules.
    expect(unit.chosenPositionCode).toBeNull();
    expect(registry.registerUnit).not.toHaveBeenCalled();
    expect(registry.reconcile).not.toHaveBeenCalled();
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
});
