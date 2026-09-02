import EVT from "../../EventCatalog.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import ReplayDriver from "../../replay/ReplayDriver.js";
import { setupGameWithHands, deployUnit, advanceToRound, getCardIdByName, cards } from "../utils.js";

/**
 * Card-level integration: effect primitives exercised through their real
 * cards and the authoritative `use-ability-action` path (rather than calling
 * handlers directly).
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

describe("effect primitives via real cards", () => {
  test("Lo Po Bia Ren steals the enemy's cheapest Shinheuh", () => {
    const game = setupGameWithHands({ Alice: ["Test Anima Unit"], Bob: ["Test Shinheuh"] });
    const ren = deployUnit(game, "Alice", "Test Anima Unit", "wave-controller");
    deployUnit(game, "Bob", "Test Shinheuh", "frontline");

    useAbility(game, "Alice", ren.id, "1");

    const aliceUnits = [
      ...game.playerStates.Alice.field.frontline,
      ...game.playerStates.Alice.field.backline,
    ];
    expect(aliceUnits.some((u) => u.card.name === "Test Shinheuh")).toBe(true);
  });

  test("Lo Po Bia Ren's summon resolves as a no-op when no 2-cost Shinheuh exists", () => {
    const game = setupGameWithHands({ Alice: ["Test Anima Unit"] });
    const ren = deployUnit(game, "Alice", "Test Anima Unit", "wave-controller");

    expect(() => useAbility(game, "Alice", ren.id, "0")).not.toThrow();

    const aliceUnits = [
      ...game.playerStates.Alice.field.frontline,
      ...game.playerStates.Alice.field.backline,
    ];
    expect(aliceUnits.map((u) => u.card.name)).toEqual(["Test Anima Unit"]);
  });

  test("Jyu Viole Grace copies an enemy ability", () => {
    const game = setupGameWithHands({ Alice: ["Test Copy Ability Unit"], Bob: ["Test Shinheuh"] });
    const grace = deployUnit(game, "Alice", "Test Copy Ability Unit", "wave-controller");
    const bull = deployUnit(game, "Bob", "Test Shinheuh", "frontline");

    useAbility(game, "Alice", grace.id, "1");

    // The copied "deal 3 to an enemy" targets Bob's Bull, killing it.
    expect(game._findUnit(bull.id)).toBeNull();
  });

  test("Monkeyman's peek ability reveals a card from the opponent's hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Shinheuh", "Test Shinheuh"] });
    const monkeyman = deployUnit(game, "Alice", "Test Scout", "scout");
    const handSize = game.playerStates.Bob.hand.length;
    const peeked = [];
    game.eventBus.on(EVT.HAND_PEEKED, (p) => peeked.push(p), { phase: "post" });

    useAbility(game, "Alice", monkeyman.id, "0");

    expect(peeked).toHaveLength(1);
    expect(peeked[0].owner).toBe("Bob");
    expect(peeked[0].observer).toBe("Alice");
    expect(game.playerStates.Bob.hand).toHaveLength(handSize);
  });

  test("Evan Edrok forces an enemy to switch position", () => {
    const game = setupGameWithHands({ Alice: ["Test Switch Position Unit"], Bob: ["Test Multi Position II"] });
    const evan = deployUnit(game, "Alice", "Test Switch Position Unit", "scout");
    const khunRan = deployUnit(game, "Bob", "Test Multi Position II", "fisherman");

    useAbility(game, "Alice", evan.id, "1");

    expect(khunRan.placedPositionCode).toBe("spear-bearer");
  });

  test("the affiliation granter gains a random donor affiliation and shared-affiliation readers see it", () => {
    const game = setupGameWithHands({
      Alice: ["Test Affiliation Granter", "Test Affiliation Donor Fug", "Test Affiliation Donor Wolhaiksong", "Test Affiliation Kin"],
    });
    const granter = deployUnit(game, "Alice", "Test Affiliation Granter", "wave-controller");
    const donorFug = deployUnit(game, "Alice", "Test Affiliation Donor Fug", "scout");
    const donorWol = deployUnit(game, "Alice", "Test Affiliation Donor Wolhaiksong", "fisherman");
    const kin = deployUnit(game, "Alice", "Test Affiliation Kin", "spear-bearer");

    useAbility(game, "Alice", granter.id, "0");

    const granted = [...game.modifierStack.getActiveKeys(granter.id, "affiliation")];
    expect(granted).toHaveLength(1);
    expect(["fug", "wolhaiksong"]).toContain(granted[0]);
    const [mod] = game.modifierStack.getModifiers(granter.id, "affiliation");
    expect(mod.sourceId).toBe(granter.id);

    // The granter's shared-affiliation heal reaches every ally holding the
    // granted affiliation — the non-donor kin included — and skips the rest.
    for (const u of [donorFug, donorWol, kin]) u.currentHp -= 1;
    useAbility(game, "Alice", granter.id, "1");

    const reachable = granted[0] === "fug" ? [donorFug, kin] : [donorWol];
    const unreachable = granted[0] === "fug" ? [donorWol] : [donorFug, kin];
    for (const u of reachable) expect(u.currentHp).toBe(u.card.maxHp);
    for (const u of unreachable) expect(u.currentHp).toBe(u.card.maxHp - 1);
  });

  test("a returning unit without retain_equipment detaches its equipment de-ignited to hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner", "Test Ignite Weapon"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");
    equipFromHand(game, unit, "Test Ignite Weapon");
    LifecycleEngine.transformEquipment(game, unit, getCardIdByName("Test Ignite Weapon - Ignited"));
    expect(unit.equipmentAttachments[0].name).toBe("Test Ignite Weapon - Ignited");

    useAbility(game, "Alice", unit.id, "0");

    const hand = game.playerStates.Alice.hand;
    expect(hand.some((c) => c.name === "Test Returner")).toBe(true);
    expect(hand.some((c) => c.name === "Test Ignite Weapon")).toBe(true);
    expect(hand.some((c) => c.name === "Test Ignite Weapon - Ignited")).toBe(false);
  });

  test("a retain_equipment bearer keeps its equipment through the hand trip and re-attaches it ignited on redeploy", () => {
    const game = setupGameWithHands({
      Alice: ["Test Retaining Returner", "Test Return Equipment"],
      Bob: ["Test Filler 1"],
    });
    const bearer = deployUnit(game, "Alice", "Test Retaining Returner", "fisherman");
    deployUnit(game, "Bob", "Test Filler 1", "fisherman");
    equipFromHand(game, bearer, "Test Return Equipment");

    // The bearer Slays the lone enemy: the weapon ignites through the real trigger.
    useAbility(game, "Alice", bearer.id, "1");
    expect(bearer.equipmentAttachments[0].name).toBe("Test Return Equipment - Ignited");

    useAbility(game, "Alice", bearer.id, "0");

    expect(game._findUnit(bearer.id)).toBeNull();
    const hand = game.playerStates.Alice.hand;
    const bearerCard = hand.find((c) => c.name === "Test Retaining Returner");
    expect(bearerCard.retainedEquipment.map((c) => c.name)).toEqual(["Test Return Equipment - Ignited"]);
    expect(hand.some((c) => c.type === "equipment")).toBe(false);

    // Serialized hand state observes the retained attachment.
    const handEntry = game.toSerializedState().players.Alice.hand
      .find((c) => c.cardId === getCardIdByName("Test Retaining Returner"));
    expect(handEntry.retainedEquipment).toEqual([
      { cardId: getCardIdByName("Test Return Equipment - Ignited"), id: bearerCard.retainedEquipment[0].id },
    ]);

    const redeployed = deployUnit(game, "Alice", "Test Retaining Returner", "fisherman");
    expect(bearerCard.retainedEquipment).toHaveLength(0);
    expect(redeployed.equipmentAttachments.map((c) => c.name)).toEqual(["Test Return Equipment - Ignited"]);
    expect(redeployed.equipmentAttachments[0].ignitedFrom).toBe(getCardIdByName("Test Return Equipment"));
    // The fresh unit's equipment effects were re-resolved against it; the
    // outgoing unit's entries died with it.
    expect(game.modifierStack.has(redeployed.id, "stat", "damage")).toBe(true);
    expect(game.modifierStack.has(bearer.id, "stat", "damage")).toBe(false);
  });

  test("a return-to-hand and redeploy sequence replays to identical serialized state", () => {
    const game = setupGameWithHands({
      Alice: ["Test Retaining Returner", "Test Return Equipment"],
      Bob: ["Test Filler 1"],
    });
    advanceToRound(game, 4);

    const bearerHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Retaining Returner");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: bearerHandId, placedPositionCode: "fisherman" } });
    const bearer = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Test Retaining Returner");

    const fillerHandId = game.playerStates.Bob.hand.findIndex((c) => c.name === "Test Filler 1");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Bob", handId: fillerHandId, placedPositionCode: "fisherman" } });

    const weaponHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Return Equipment");
    game.processAction({ type: "equip-equipment-action", data: { source: "player", username: "Alice", handId: weaponHandId, targetUnitId: bearer.id } });

    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    game.processAction({ type: "use-ability-action", data: { source: "player", username: "Alice", unitId: bearer.id, abilityCode: "1" } });
    expect(bearer.equipmentAttachments[0].name).toBe("Test Return Equipment - Ignited");

    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });
    game.processAction({ type: "use-ability-action", data: { source: "player", username: "Alice", unitId: bearer.id, abilityCode: "0" } });

    const returnedHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Retaining Returner");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: returnedHandId, placedPositionCode: "fisherman" } });
    const redeployed = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Test Retaining Returner");
    expect(redeployed.equipmentAttachments.map((c) => c.name)).toEqual(["Test Return Equipment - Ignited"]);

    const finalState = game.toSerializedState();
    const replayed = ReplayDriver.replay(game.logger.getReplayLog(), { cards });
    expect(replayed.toSerializedState()).toEqual(finalState);
  });
});
