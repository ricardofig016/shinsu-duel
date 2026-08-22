import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import Card from "../../Card.js";
import ModifierService from "../../services/ModifierService.js";
import { getCardIdByName, cards } from "../utils.js";

const players = ["Alice", "Bob"];
let _unitSeq = 0;

function createGame() {
  return new GameState("TEST", players, {}, null, { rng: new SeededRng(1), cards });
}

function putUnit(game, username, name, position = "fisherman") {
  const cardId = getCardIdByName(name);
  const card = new Card(cardId, game.cards[cardId], username, game.eventBus);
  const unit = {
    id: `Unit#${name}#${++_unitSeq}`,
    owner: username,
    card,
    currentHp: card.maxHp,
    placedPositionCode: position,
    isAlive() { return this.currentHp > 0; },
  };
  const field = game.playerStates[username].field;
  (game.constructor.positions[position]?.line === "backline" ? field.backline : field.frontline).push(unit);
  game._indexUnit(unit);
  return unit;
}

describe("ModifierService", () => {
  test("isModifier recognizes modifier node types only", () => {
    expect(ModifierService.isModifier({ type: "modify_stat", stat: "damage", amount: 1, target: { side: "self" } })).toBe(true);
    expect(ModifierService.isModifier({ type: "retain_equipment" })).toBe(true);
    expect(ModifierService.isModifier({ type: "modify_ability", target: { side: "self" }, effect: { type: "noop" } })).toBe(true);
    expect(ModifierService.isModifier({ type: "deal_damage", amount: 1 })).toBe(false);
    expect(ModifierService.isModifier(null)).toBe(false);
  });

  test("modify_stat damage applies a stat entry and is read by getDamageDealt", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");
    const enemy = putUnit(game, "Bob", "Test Shinheuh", "fisherman");

    ModifierService.applyModifier(
      { type: "modify_stat", stat: "damage", amount: 2, target: { side: "self" } },
      game,
      { sourceId: "Passive#u#0", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getDamageDealt(unit, enemy)).toBe(2);
    // Revoke by source undoes it.
    game.modifierStack.removeBySource("Passive#u#0");
    expect(game.modifierStack.getDamageDealt(unit, enemy)).toBe(0);
  });

  test("modify_stat damage_taken honors the `source` filter", () => {
    const game = createGame();
    const target = putUnit(game, "Bob", "Test Shinheuh", "fisherman");
    const spear = putUnit(game, "Alice", "Test Shinheuh", "spear-bearer");
    const sword = putUnit(game, "Alice", "Test Shinheuh", "fisherman");

    ModifierService.applyModifier(
      { type: "modify_stat", stat: "damage_taken", amount: 4, target: { side: "self" }, source: { position: "spear-bearer" } },
      game,
      { sourceId: "Passive#t#0", sourceUnit: target, sourceOwner: "Bob" }
    );

    expect(game.modifierStack.getDamageTaken(target, spear)).toBe(4);
    expect(game.modifierStack.getDamageTaken(target, sword)).toBe(0);
  });

  test("modify_stat hp raises current and max HP, and revokes on removeBySource", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");
    const beforeMax = unit.card.maxHp;
    const beforeCurrent = unit.currentHp;

    ModifierService.applyModifier(
      { type: "modify_stat", stat: "hp", amount: 2, target: { side: "self" } },
      game,
      { sourceId: "Equip#hp", sourceType: "equipment", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(unit.card.maxHp).toBe(beforeMax + 2);
    expect(unit.currentHp).toBe(beforeCurrent + 2);

    game.modifierStack.removeBySource("Equip#hp");
    // onRevoke bridge (wired in GameState) restores the raised HP.
    expect(unit.card.maxHp).toBe(beforeMax);
    expect(unit.currentHp).toBe(beforeCurrent);
  });

  test("modify_condition stores a victim-filtered amplifier", () => {
    const game = createGame();
    const source = putUnit(game, "Alice", "Test Shinheuh", "scout");
    const highRanker = putUnit(game, "Bob", "Test Shinheuh", "fisherman");
    highRanker.card.rank = "high ranker";
    const regular = putUnit(game, "Bob", "Test Shinheuh", "scout");
    regular.card.rank = "regular";

    ModifierService.applyModifier(
      { type: "modify_condition", condition: "poisoned", amount: 2, target: { side: "enemy", rank: "high ranker" } },
      game,
      { sourceId: "Passive#p#0", sourceUnit: source, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getConditionAmplifier(source, highRanker, "poisoned")).toBe(2);
    expect(game.modifierStack.getConditionAmplifier(source, regular, "poisoned")).toBe(0);
  });

  test("modify_keyword grants a keyword and respects the `first` gate", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "scout");

    ModifierService.applyModifier(
      { type: "modify_keyword", keyword: "free", first: true, target: { side: "self" } },
      game,
      { sourceId: "Passive#k#0", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getKeywords(unit, true).has("free")).toBe(true);
    expect(game.modifierStack.getKeywords(unit, false).has("free")).toBe(false);
  });

  test("modify_targeting untargetable_by records a blocked filter", () => {
    const game = createGame();
    const protectedUnit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");

    ModifierService.applyModifier(
      { type: "modify_targeting", rule: "untargetable_by", target: { side: "any", condition: "burned", conditionValue: 3 } },
      game,
      { sourceId: "Passive#tg#0", sourceUnit: protectedUnit, sourceOwner: "Alice" }
    );

    const rules = game.modifierStack.getTargetingRules(protectedUnit);
    expect(rules.untargetableBy).toEqual({ side: "any", condition: "burned", conditionValue: 3 });
  });

  test("modify_stat cost keyed to a player consults through getEffectiveCost", () => {
    const game = createGame();
    const source = putUnit(game, "Alice", "Test Shinheuh", "scout");
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 10, recharged: 0 };

    ModifierService.applyModifier(
      { type: "modify_stat", stat: "cost", amount: 1, target: { side: "enemy" }, cardType: "skill" },
      game,
      { sourceId: "Passive#c#0", sourceUnit: source, sourceOwner: "Alice" }
    );

    const skillCard = new Card(getCardIdByName("Test Poison Skill"), game.cards[getCardIdByName("Test Poison Skill")], "Bob", game.eventBus);
    expect(ModifierService.getEffectiveCost(skillCard, "Bob", game)).toBe(skillCard.cost + 1);

    // Non-skill cards are unaffected by the cardType filter.
    const unitCard = new Card(getCardIdByName("Test Shinheuh"), game.cards[getCardIdByName("Test Shinheuh")], "Bob", game.eventBus);
    expect(ModifierService.getEffectiveCost(unitCard, "Bob", game)).toBe(unitCard.cost);
  });

  test("modify_ability attaches an ability-augment entry", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "scout");

    ModifierService.applyModifier(
      { type: "modify_ability", target: { side: "self" }, effect: { type: "give_condition", condition: "frozen", target: { side: "enemy" } } },
      game,
      { sourceId: "Equip#aug", sourceType: "equipment", sourceUnit: unit, sourceOwner: "Alice" }
    );

    const augments = game.modifierStack.getAbilityAugments(unit);
    expect(augments).toHaveLength(1);
    expect(augments[0].effect.type).toBe("give_condition");
    expect(augments[0].sourceId).toBe("Equip#aug");
  });

  test("modify_cost is consulted at play time via getEffectiveCost", () => {
    const game = createGame();
    const card = new Card(getCardIdByName("Test Armor"), game.cards[getCardIdByName("Test Armor")], "Alice", game.eventBus);

    // Without Ha Jinsung in Alice's starting deck, no discount.
    expect(ModifierService.getEffectiveCost(card, "Alice", game)).toBe(card.cost);

    // With Ha Jinsung recorded, the `if` predicate passes → -2.
    game.playerStates.Alice.startingDeck.push("Ha Jinsung");
    expect(ModifierService.getEffectiveCost(card, "Alice", game)).toBe(card.cost - 2);
  });

  test("a modifier with a false `if` gate applies nothing", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");

    const result = ModifierService.applyModifier(
      { type: "modify_stat", stat: "damage", amount: 2, target: { side: "self" }, if: { type: "has_unit", target: { side: "ally", name: "Nobody" } } },
      game,
      { sourceId: "Passive#u#0", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(result.reason).toBe("if-false");
    expect(game.modifierStack.getDamageDealt(unit, null)).toBe(0);
  });

  test("modify_targeting ignore_taunt marks the source unit", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");

    ModifierService.applyModifier(
      { type: "modify_targeting", rule: "ignore_taunt", target: { side: "self" } },
      game,
      { sourceId: "Passive#t#0", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getTargetingRules(unit).ignoreTaunt).toBe(true);
  });

  test("modify_repeat records the repeat count", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");

    ModifierService.applyModifier(
      { type: "modify_repeat", amount: 2, target: { side: "self" } },
      game,
      { sourceId: "Equip#r#0", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.getRepeat(unit)).toBe(2);
  });

  test("retain_equipment marks the source unit", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");

    ModifierService.applyModifier(
      { type: "retain_equipment" },
      game,
      { sourceId: "Passive#r#0", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(game.modifierStack.hasRetainEquipment(unit)).toBe(true);
  });

  test("matchesUnitFilter evaluates trait, rank, position, and name", () => {
    const game = createGame();
    const unit = putUnit(game, "Alice", "Test Shinheuh", "fisherman");
    unit.card.rank = "regular";
    game.modifierStack.apply({ sourceId: "System", sourceType: "system", targetId: unit.id, type: "trait", key: "taunt", value: 1 });

    expect(game.modifierStack.matchesUnitFilter(unit, { trait: "taunt" })).toBe(true);
    expect(game.modifierStack.matchesUnitFilter(unit, { trait: "barrier" })).toBe(false);
    expect(game.modifierStack.matchesUnitFilter(unit, { rank: "regular" })).toBe(true);
    expect(game.modifierStack.matchesUnitFilter(unit, { position: "fisherman" })).toBe(true);
    expect(game.modifierStack.matchesUnitFilter(unit, { name: "Test Shinheuh" })).toBe(true);
    expect(game.modifierStack.matchesUnitFilter(unit, { name: "Other" })).toBe(false);
    expect(game.modifierStack.matchesUnitFilter(unit, null)).toBe(true);
  });
});
