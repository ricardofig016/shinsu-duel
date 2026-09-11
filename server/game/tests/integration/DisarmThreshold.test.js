import { setupGameWithHands, deployUnit } from "../utils.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";

/**
 * The `deal_damage` trigger's `amount` threshold on an equipment effect:
 * "when my bearer deals 7+ damage to a single target, Disarm it".
 *
 * The threshold reads the hit's full post-modifier amount (overkill counts),
 * per damage application, from any direct damage the bearer deals.
 */

function useAbility(game, username, unitId, abilityCode) {
  game.currentTurn = username;
  game.round = 15;
  const playerState = game.playerStates[username];
  playerState.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  // Tests use several abilities in one round; the slot cost is not what they
  // exercise, so free the slot the way a fresh round would.
  for (const slot of Object.values(playerState.combatSlots || {})) slot.available = true;
  game.processAction({
    type: "use-ability-action",
    data: { source: "player", username, unitId, abilityCode },
  });
}

function equipOn(game, unit, cardName) {
  game.currentTurn = unit.owner;
  game.round = 15;
  game.playerStates[unit.owner].shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const handId = game.playerStates[unit.owner].hand.findIndex((c) => c.name === cardName);
  game.processAction({ type: "equip-equipment-action", data: { source: "player", username: unit.owner, handId, targetUnitId: unit.id } });
}

function setupThresholdGame(bobUnit) {
  const game = setupGameWithHands({
    Alice: ["Test Big Hitter", "Test Disarm Lance"],
    Bob: [bobUnit, "Test Ignite Weapon"],
  });
  const hitter = deployUnit(game, "Alice", "Test Big Hitter", "fisherman");
  const enemy = deployUnit(game, "Bob", bobUnit, "fisherman");
  equipOn(game, hitter, "Test Disarm Lance");
  return { game, hitter, enemy };
}

describe("disarm damage threshold (Test Disarm Lance)", () => {
  test("disarms the damaged target on a 7+ hit and not below", () => {
    const { game, hitter, enemy } = setupThresholdGame("Test Trait Dummy");
    equipOn(game, enemy, "Test Ignite Weapon");

    useAbility(game, "Alice", hitter.id, "0"); // deal 6 — below the threshold
    expect(enemy.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(false);

    useAbility(game, "Alice", hitter.id, "1"); // deal 12 — reaches the threshold
    expect(enemy.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(true);
  });

  test("incoming damage modifiers count: a 12 hit through Resilient 10 stays below the threshold", () => {
    const { game, hitter, enemy } = setupThresholdGame("Test Trait Unit"); // resilient 10
    equipOn(game, enemy, "Test Ignite Weapon");

    useAbility(game, "Alice", hitter.id, "1"); // 12 - 10 resilient = 2

    expect(enemy.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);
  });

  test("overkill counts: an Undying survivor is disarmed", () => {
    const { game, hitter, enemy } = setupThresholdGame("Test Overkill Dummy"); // undying
    equipOn(game, enemy, "Test Ignite Weapon");
    expect(enemy.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);

    // 9 HP left: the 12 hit applies 9 but is a 12 hit. The kill check saves
    // the dummy through Undying after the disarm has run.
    enemy.currentHp = 9;
    useAbility(game, "Alice", hitter.id, "1");

    expect(game._findUnit(enemy.id)).toBe(enemy);
    expect(enemy.currentHp).toBe(1); // Undying
    expect(enemy.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(true);
  });

  test("a bare damage event with only the applied amount still matches (counterattack shape)", () => {
    const { game, hitter, enemy } = setupThresholdGame("Test Trait Dummy");
    equipOn(game, enemy, "Test Ignite Weapon");
    expect(enemy.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);

    // Counterattack damage reaches the same event without a pipeline-built
    // hitAmount; the threshold falls back to the applied amount.
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: hitter.id, targetId: enemy.id, amount: 8 });

    expect(enemy.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(true);
  });

  test("the ignited lance disarms and silences on the same 7+ hit", () => {
    const { game, hitter, enemy } = setupThresholdGame("Test Trait Dummy");

    // Ignition: the 10+ hit disarms nothing (the dummy has no equipment yet)
    // but flips the lance.
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: hitter.id, targetId: enemy.id, amount: 10, hitAmount: 10 });
    expect(hitter.equipmentAttachments.map((c) => c.name)).toEqual(["Test Disarm Lance - Ignited"]);

    equipOn(game, enemy, "Test Ignite Weapon");
    useAbility(game, "Alice", hitter.id, "1");

    expect(enemy.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(true);
    expect(game.modifierStack.getActiveKeys(enemy.id, "trait").size).toBe(0);
  });

  test("the base lance's disarm subscription does not survive ignition", () => {
    const { game, hitter, enemy } = setupThresholdGame("Test Trait Dummy");

    // Ignite, then strip the lance: the bearer no longer holds any lance.
    game.eventBus.emit(EVT.DAMAGE_APPLIED, { sourceId: hitter.id, targetId: enemy.id, amount: 10, hitAmount: 10 });
    LifecycleEngine.disarmUnit(game, hitter, { zone: "hand", owner: "Alice" });
    expect(hitter.equipmentAttachments).toHaveLength(0);

    // The enemy re-arms. A 7+ hit from the lanceless bearer must do nothing:
    // a surviving base subscription would disarm the victim anyway.
    equipOn(game, enemy, "Test Ignite Weapon");
    useAbility(game, "Alice", hitter.id, "1");

    expect(enemy.equipmentAttachments.map((c) => c.name)).toEqual(["Test Ignite Weapon"]);
    expect(game.playerStates.Bob.hand.some((c) => c.name === "Test Ignite Weapon")).toBe(false);
  });
});
