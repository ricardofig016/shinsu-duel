import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";

function equipFromHand(game, unit, cardName) {
  game.currentTurn = unit.owner;
  game.round = 15;
  game.playerStates[unit.owner].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[unit.owner].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "equip-equipment-action", data: { source: "player", username: unit.owner, handId, targetUnitId: unit.id } });
}

describe("LifecycleEngine.returnUnitToHand", () => {
  test("the card lands in the owner's hand and the unit leaves the board", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");

    const result = LifecycleEngine.returnUnitToHand(game, unit);

    expect(result).toEqual({ returned: true, retainedEquipment: 0 });
    expect(game._findUnit(unit.id)).toBeNull();
    expect(game.playerStates.Alice.field.frontline).toHaveLength(0);
    expect(game.playerStates.Alice.hand).toContain(unit.card);
  });

  test("no kill semantics fire", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");
    const killEvents = [];
    for (const eventName of [
      EVT.UNIT_DEATH_INTENT,
      EVT.UNIT_KILLED,
      EVT.UNIT_DESTROY_INTENT,
      EVT.UNIT_DESTROYED,
    ]) {
      game.eventBus.on(eventName, () => killEvents.push(eventName));
    }
    const returned = [];
    game.eventBus.on(EVT.UNIT_RETURNED_TO_HAND, (payload) => returned.push(payload));

    LifecycleEngine.returnUnitToHand(game, unit);

    expect(killEvents).toEqual([]);
    expect(returned).toHaveLength(1);
    expect(returned[0]).toEqual(expect.objectContaining({ unitId: unit.id, owner: "Alice", retainedEquipment: 0 }));
  });

  test("default detach sends ignited equipment de-ignited to the controller's hand", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner", "Test Ignite Weapon"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");
    equipFromHand(game, unit, "Test Ignite Weapon");
    LifecycleEngine.transformEquipment(game, unit, getCardIdByName("Test Ignite Weapon - Ignited"));
    expect(unit.equipmentAttachments[0].name).toBe("Test Ignite Weapon - Ignited");

    LifecycleEngine.returnUnitToHand(game, unit);

    const hand = game.playerStates.Alice.hand;
    expect(hand.some((c) => c.name === "Test Returner")).toBe(true);
    const weapon = hand.find((c) => c.name === "Test Ignite Weapon");
    expect(weapon).toBeDefined();
    expect(weapon.ignitedFrom).toBeNull();
    expect(hand.some((c) => c.name === "Test Ignite Weapon - Ignited")).toBe(false);
    expect(game.modifierStack.has(unit.id, "stat", "damage")).toBe(false);
  });

  test("retain keeps the attachments on the card with ignited state preserved", () => {
    const game = setupGameWithHands({ Alice: ["Test Retaining Returner", "Test Return Equipment"] });
    const unit = deployUnit(game, "Alice", "Test Retaining Returner", "fisherman");
    equipFromHand(game, unit, "Test Return Equipment");
    LifecycleEngine.transformEquipment(game, unit, getCardIdByName("Test Return Equipment - Ignited"));

    const result = LifecycleEngine.returnUnitToHand(game, unit);

    expect(result.returned).toBe(true);
    expect(result.retainedEquipment).toBe(1);
    const hand = game.playerStates.Alice.hand;
    const bearerCard = hand.find((c) => c.name === "Test Retaining Returner");
    expect(bearerCard.retainedEquipment).toHaveLength(1);
    expect(bearerCard.retainedEquipment[0].name).toBe("Test Return Equipment - Ignited");
    expect(bearerCard.retainedEquipment[0].ignitedFrom).toBe(getCardIdByName("Test Return Equipment"));
    expect(hand.some((c) => c.type === "equipment")).toBe(false);
  });

  test("the returned unit's conditions and traits are gone", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");
    game.modifierStack.apply({
      sourceId: "Test#1", sourceType: "system", targetId: unit.id,
      type: "condition", key: "poisoned", value: 2, operation: "add",
    });
    game.modifierStack.apply({
      sourceId: "Test#2", sourceType: "system", targetId: unit.id,
      type: "trait", key: "strong", value: 2, operation: "add",
    });

    LifecycleEngine.returnUnitToHand(game, unit);

    expect(game.modifierStack.has(unit.id, "condition", "poisoned")).toBe(false);
    expect(game.modifierStack.has(unit.id, "trait", "strong")).toBe(false);
  });

  test("returning a unit that is no longer on the field is a no-op", () => {
    const game = setupGameWithHands({ Alice: ["Test Returner"] });
    const unit = deployUnit(game, "Alice", "Test Returner", "fisherman");
    LifecycleEngine.returnUnitToHand(game, unit);

    expect(LifecycleEngine.returnUnitToHand(game, unit)).toEqual({ returned: false });
    expect(LifecycleEngine.returnUnitToHand(game, null)).toEqual({ returned: false });
    expect(game.playerStates.Alice.hand.filter((c) => c.name === "Test Returner")).toHaveLength(1);
  });
});
