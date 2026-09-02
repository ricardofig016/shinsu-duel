import Card from "../../Card.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import { setupGameWithHands, deployUnit, advanceToRound, getCardIdByName, cards } from "../utils.js";

/**
 * Passive trigger wiring exercised through real cards and the authoritative
 * action paths: the seven trigger types that reach PassiveManager through
 * their shipped card shapes (draw, reclaim, equip, dies, ally_dies,
 * free_ability_played, evolve).
 */

function useAbility(game, username, unitId, abilityCode) {
  game.currentTurn = username;
  game.processAction({
    type: "use-ability-action",
    data: { source: "player", username, unitId, abilityCode },
  });
}

function equipFromHand(game, unit, cardName) {
  game.currentTurn = unit.owner;
  game.round = 15;
  game.playerStates[unit.owner].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[unit.owner].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "equip-equipment-action", data: { source: "player", username: unit.owner, handId, targetUnitId: unit.id } });
}

function playSkillFromHand(game, username, cardName) {
  game.currentTurn = username;
  game.round = 15;
  game.playerStates[username].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[username].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "play-skill-action", data: { source: "player", username, handId } });
}

describe("passive triggers via real cards", () => {
  test("a draw passive chains through a real round-start draw", () => {
    const game = setupGameWithHands({ Alice: ["Test Draw Passive Unit"], Bob: [] });
    deployUnit(game, "Alice", "Test Draw Passive Unit", "scout");

    // Deck top (array end): one equipment over a filler, so the passive's own
    // draw pulls the filler beneath it and the chain stops there.
    const armorId = getCardIdByName("Test Armor");
    const fillerId = getCardIdByName("Test Filler 2");
    const filler = new Card(fillerId, game.cards[fillerId], "Alice", game.eventBus);
    const armor = new Card(armorId, game.cards[armorId], "Alice", game.eventBus);
    game.playerStates.Alice.deck.push(filler, armor);

    const handBefore = game.playerStates.Alice.hand.length;
    advanceToRound(game, game.round + 1);

    // The round draw pulled the equipment, the passive fired and pulled the
    // filler: two cards beyond the pre-draw hand.
    expect(game.playerStates.Alice.hand).toContain(armor);
    expect(game.playerStates.Alice.hand).toContain(filler);
    expect(game.playerStates.Alice.hand.length).toBe(handBefore + 2);
  });

  test("a reclaim passive compresses the reclaimed equipment, not another card in hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Reclaim Passive Unit", "Test Reclaim Skill", "Test Armor"], Bob: [] });
    deployUnit(game, "Alice", "Test Reclaim Passive Unit", "fisherman");

    // One equipment goes to the discard; another (Test Armor) stays in hand,
    // so broken threading would open a card selection or compress the wrong
    // card instead.
    const fillerEquipId = getCardIdByName("Test Equipment Filler");
    const discardedEquip = new Card(fillerEquipId, game.cards[fillerEquipId], "Alice", game.eventBus);
    game.playerStates.Alice.discard.push(discardedEquip);

    playSkillFromHand(game, "Alice", "Test Reclaim Skill");

    expect(discardedEquip.costReduction).toBe(1);
    const armor = game.playerStates.Alice.hand.find((c) => c.name === "Test Armor");
    expect(armor.costReduction).toBe(0);
    expect(game.hasUnresolvedDecisions()).toBe(false);
  });

  test("an equip passive reclaims when its named equipment is attached", () => {
    const game = setupGameWithHands({ Alice: ["Test Equip Passive Unit", "Test Armor"], Bob: [] });
    const unit = deployUnit(game, "Alice", "Test Equip Passive Unit", "fisherman");

    const fillerEquipId = getCardIdByName("Test Equipment Filler");
    game.playerStates.Alice.discard.push(new Card(fillerEquipId, game.cards[fillerEquipId], "Alice", game.eventBus));

    equipFromHand(game, unit, "Test Armor");

    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Equipment Filler")).toBe(true);
  });

  test("a dies passive fires through the real lethal pipeline and not on a return to hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Damage Skill"], Bob: ["Test Dies Passive Unit", "Test Dies Passive Unit"] });
    const diesUnit = deployUnit(game, "Bob", "Test Dies Passive Unit", "fisherman");
    const before = game.playerStates.Bob.lighthouses.amount;

    // Alice's skill deals 1 to an enemy; the 1-HP unit dies through the real
    // pipeline and its own death passive lights Bob up.
    playSkillFromHand(game, "Alice", "Test Damage Skill");
    expect(game._findUnit(diesUnit.id)).toBeNull();
    expect(game.playerStates.Bob.lighthouses.amount).toBe(before + 1);

    // Returning a unit to hand is neither a kill nor a discard: a second dies
    // unit returns without firing.
    const secondId = getCardIdByName("Test Dies Passive Unit");
    game.playerStates.Bob.hand.push(new Card(secondId, game.cards[secondId], "Bob", game.eventBus));
    const survivor = deployUnit(game, "Bob", "Test Dies Passive Unit", "fisherman");
    LifecycleEngine.returnUnitToHand(game, survivor);
    expect(game.playerStates.Bob.lighthouses.amount).toBe(before + 1);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Dies Passive Unit")).toBe(true);
  });

  test("an ally_dies passive fires for an allied Regular's death and for the unit's own", () => {
    const game = setupGameWithHands({ Alice: ["Test Ally Dies Passive Unit", "Test Filler 1"], Bob: ["Test Damage Skill"] });
    const watcher = deployUnit(game, "Alice", "Test Ally Dies Passive Unit", "fisherman");
    const filler = deployUnit(game, "Alice", "Test Filler 1", "fisherman");
    const before = game.playerStates.Alice.lighthouses.amount;

    // The allied Regular dies through the real pipeline.
    LifecycleEngine.killUnit(game, filler, { sourceId: watcher.id, sourceOwner: "Alice" });
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 1);

    // The watcher's own death is an ally death too (RULES.md ally definition):
    // wounded to 1, then Bob's skill deals the last point at the only legal
    // enemy target.
    watcher.currentHp = 1;
    playSkillFromHand(game, "Bob", "Test Damage Skill");
    expect(game._findUnit(watcher.id)).toBeNull();
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before + 2);
  });

  test("a Free ability's use extinguishes the user's own lighthouses", () => {
    const game = setupGameWithHands({ Alice: ["Test Free Keyword Unit", "Test Free Ability Landmark"], Bob: [] });
    const freeUnit = deployUnit(game, "Alice", "Test Free Keyword Unit", "scout");
    deployUnit(game, "Alice", "Test Free Ability Landmark", "fisherman");
    const before = game.playerStates.Alice.lighthouses.amount;

    // The first ability this round has Free through the unit's first-scoped
    // keyword: the use is announced with free: true and the landmark reacts.
    useAbility(game, "Alice", freeUnit.id, "0");
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before - 5);

    // The second use this round is not Free (the first-scoped keyword is
    // spent), so nothing further is extinguished.
    useAbility(game, "Alice", freeUnit.id, "1");
    expect(game.playerStates.Alice.lighthouses.amount).toBe(before - 5);
  });

  test("an evolve passive fires through a real evolution and not through a transform revert", () => {
    const game = setupGameWithHands({ Alice: ["Test Evolve Passive Unit", "Test Armor"], Bob: [] });

    // The deploy-triggered evolution fires during the deploy action; the unit
    // enters the field already evolved, with the base form's evolve passive
    // having created its card.
    game.currentTurn = "Alice";
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const handId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Evolve Passive Unit");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId, placedPositionCode: "fisherman" } });

    const unit = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Test Evolve Passive Unit II");
    expect(unit).toBeDefined();
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Test Filler 1")).toBe(true);

    // A transform revert is not an evolution: no firing, no second card.
    const handSize = game.playerStates.Alice.hand.length;
    LifecycleEngine.transformUnit(game, unit, getCardIdByName("Test Evolve Passive Unit"));
    expect(unit.card.name).toBe("Test Evolve Passive Unit");
    expect(game.playerStates.Alice.hand.length).toBe(handSize);
  });
});
