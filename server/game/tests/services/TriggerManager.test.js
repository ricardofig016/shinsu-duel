import { jest } from "@jest/globals";
import TriggerManager from "../../services/TriggerManager.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EventBus from "../../EventBus.js";
import GameClock from "../../GameClock.js";
import EVT from "../../EventCatalog.js";

describe("TriggerManager trigger subscriptions", () => {
  let bus, clock, manager, gameState, unit;

  beforeEach(() => {
    clock = new GameClock();
    bus = new EventBus(clock);
    manager = new TriggerManager(bus);
    unit = { id: "Unit#1", owner: "Alice", isAlive: () => true, card: { rank: "regular", name: "Monkeyman" } };
    gameState = { _findUnit: (id) => (id === "Unit#1" ? unit : null) };
    jest.spyOn(LifecycleEngine, "transformUnit").mockReturnValue(undefined);
    jest.spyOn(LifecycleEngine, "transformEquipment").mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function register(triggers, targetCardId = 99, transformType = "evolution") {
    manager.registerTransformation("Unit#1", triggers, targetCardId, transformType, gameState);
  }

  test("equip trigger fires on matching equipment name and bearer", () => {
    register([{ type: "equip", cardName: "Narumada" }]);
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#1", equipment: { name: "Narumada" } });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalledWith(gameState, unit, 99);
  });

  test("equip trigger respects position requirement", () => {
    register([{ type: "equip", cardName: "Narumada", position: "fisherman" }]);
    unit.placedPositionCode = "scout";
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#1", equipment: { name: "Narumada" } });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();

    unit.placedPositionCode = "fisherman";
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#1", equipment: { name: "Narumada" } });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("equip trigger ignores non-matching equipment name", () => {
    register([{ type: "equip", cardName: "Narumada" }]);
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#1", equipment: { name: "Ice Spear" } });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("equip trigger ignores other bearers", () => {
    register([{ type: "equip", cardName: "Narumada" }]);
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "OtherUnit", equipment: { name: "Narumada" } });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("deploy trigger fires on unit:summoned", () => {
    register([{ type: "deploy" }]);
    bus.emit(EVT.UNIT_SUMMONED, { unitId: "Unit#1" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalledWith(gameState, unit, 99);
  });

  test("kill trigger fires with matching rank", () => {
    register([{ type: "kill", rank: "regular" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : { card: { rank: "regular" } });
    bus.emit(EVT.UNIT_KILLED, { killerId: "Unit#1", sourceId: "Unit#1", targetId: "Target" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("kill trigger ignores non-matching rank", () => {
    register([{ type: "kill", rank: "ranker" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : { card: { rank: "regular" } });
    bus.emit(EVT.UNIT_KILLED, { killerId: "Unit#1", sourceId: "Unit#1", targetId: "Target" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("ally_dies trigger fires for an allied unit death", () => {
    register([{ type: "ally_dies" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : null);
    bus.emit(EVT.UNIT_DESTROYED, { owner: "Alice", unitId: "Ally#2" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("ally_dies trigger ignores enemy deaths", () => {
    register([{ type: "ally_dies" }]);
    bus.emit(EVT.UNIT_DESTROYED, { owner: "Bob", unitId: "Enemy#1" }); // enemy
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("ally_dies trigger does not fire once the subscriber is removed", () => {
    register([{ type: "ally_dies" }]);
    // The dying unit's own subscription is removed before unit:destroyed fires
    // (LifecycleEngine.destroyUnit unregisters first), so its owner lookup fails
    // and its own death never triggers its own transform.
    gameState._findUnit = () => null;
    bus.emit(EVT.UNIT_DESTROYED, { owner: "Alice", unitId: "Unit#1" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("damaged_by trigger fires on matching source card name", () => {
    register([{ type: "damaged_by", source: "monkeyman" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : { card: { name: "Monkeyman" } });
    bus.emit(EVT.DAMAGE_APPLIED, { targetId: "Unit#1", sourceId: "Source" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("damaged_by trigger ignores non-matching source", () => {
    register([{ type: "damaged_by", source: "monkeyman" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : { card: { name: "Rak" } });
    bus.emit(EVT.DAMAGE_APPLIED, { targetId: "Unit#1", sourceId: "Source" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("damaged_by trigger fires on a matching source kind", () => {
    register([{ type: "damaged_by", source: "shinheuh" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : { card: { name: "Bull", kind: "shinheuh" } });
    bus.emit(EVT.DAMAGE_APPLIED, { targetId: "Unit#1", sourceId: "Source" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("damaged_by trigger ignores a non-matching source kind", () => {
    register([{ type: "damaged_by", source: "shinheuh" }]);
    gameState._findUnit = (id) => (id === "Unit#1" ? unit : { card: { name: "Rak", kind: "standard" } });
    bus.emit(EVT.DAMAGE_APPLIED, { targetId: "Unit#1", sourceId: "Source" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("round_start trigger fires on round:started", () => {
    register([{ type: "round_start" }]);
    bus.emit(EVT.ROUND_START, {});
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("round_end trigger fires on round:ended", () => {
    register([{ type: "round_end" }]);
    bus.emit(EVT.ROUND_END, {});
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("deal_damage trigger fires on damage:applied by source", () => {
    register([{ type: "deal_damage" }]);
    bus.emit(EVT.DAMAGE_APPLIED, { sourceId: "Unit#1", targetId: "Target" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("ability_used trigger fires on unit:ability:used", () => {
    register([{ type: "ability_used" }]);
    bus.emit(EVT.UNIT_ABILITY_USED, { unitId: "Unit#1" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("given trigger fires on skill:applied", () => {
    register([{ type: "given", item: "Redan" }]);
    bus.emit(EVT.SKILL_APPLIED, { targetId: "Unit#1", cardName: "Redan" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalled();
  });

  test("given trigger ignores other targets and items", () => {
    register([{ type: "given", item: "Redan" }]);
    bus.emit(EVT.SKILL_APPLIED, { targetId: "OtherUnit", cardName: "Redan" });
    bus.emit(EVT.SKILL_APPLIED, { targetId: "Unit#1", cardName: "Other" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("ignition transform uses transformEquipment", () => {
    register([{ type: "deploy" }], 50, "ignition");
    bus.emit(EVT.UNIT_SUMMONED, { unitId: "Unit#1" });
    expect(LifecycleEngine.transformEquipment).toHaveBeenCalledWith(gameState, unit, 50, null);
  });

  test("has_all_equipped trigger fires only when every listed equipment is attached", () => {
    register([{ type: "has_all_equipped", cardNames: ["Dionysos: Arms", "Dionysos: Legs", "Dionysos: Wings"] }]);
    unit.equipmentAttachments = [
      { name: "Dionysos: Arms" },
      { name: "Dionysos: Legs" },
      { name: "Dionysos: Wings" },
    ];
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#1", equipment: { name: "Dionysos: Wings" } });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalledWith(gameState, unit, 99);

    jest.clearAllMocks();
    unit.equipmentAttachments = [{ name: "Dionysos: Arms" }];
    bus.emit(EVT.EQUIPMENT_ATTACHED, { unitId: "Unit#1", equipment: { name: "Dionysos: Arms" } });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("unsupported trigger type throws", () => {
    expect(() => register([{ type: "bogus" }])).toThrow("Unsupported compiled trigger type");
  });

  test("unregisterAll removes subscriptions", () => {
    register([{ type: "round_start" }]);
    manager.unregisterAll("Unit#1");
    bus.emit(EVT.ROUND_START, {});
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("activation trigger fires on the bearer's unit:activation", () => {
    register([{ type: "activation" }]);
    bus.emit(EVT.ACTIVATION, { unitId: "Unit#1", unit, username: "Alice" });
    expect(LifecycleEngine.transformUnit).toHaveBeenCalledWith(gameState, unit, 99);
  });

  test("activation trigger ignores an activation of another unit", () => {
    register([{ type: "activation" }]);
    bus.emit(EVT.ACTIVATION, { unitId: "Unit#other", unit: null, username: "Alice" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("activation trigger does not fire on round:started", () => {
    register([{ type: "activation" }]);
    bus.emit(EVT.ROUND_START, {});
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });

  test("unregisterAll removes the activation subscription", () => {
    register([{ type: "activation" }]);
    manager.unregisterAll("Unit#1");
    bus.emit(EVT.ACTIVATION, { unitId: "Unit#1", unit, username: "Alice" });
    expect(LifecycleEngine.transformUnit).not.toHaveBeenCalled();
  });
});
