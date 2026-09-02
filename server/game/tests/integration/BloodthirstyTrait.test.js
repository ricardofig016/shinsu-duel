import LifecycleEngine from "../../services/LifecycleEngine.js";
import RemoveTraitsHandler from "../../handlers/RemoveTraitsHandler.js";
import { setupGameWithHands, deployUnit } from "../utils.js";

function deployKillerAndVictim() {
  const game = setupGameWithHands({ Alice: ["Test Bloodthirsty Unit"], Bob: ["Test Filler 1"] });
  const killer = deployUnit(game, "Alice", "Test Bloodthirsty Unit", "fisherman");
  const victim = deployUnit(game, "Bob", "Test Filler 1", "fisherman");
  return { game, killer, victim };
}

describe("Bloodthirsty trait", () => {
  test("a kill restores the trait's value in HP to the killer", () => {
    const { game, killer, victim } = deployKillerAndVictim();
    killer.currentHp = 1;

    LifecycleEngine.killUnit(game, victim, { sourceId: killer.id, sourceOwner: "Alice" });

    expect(killer.currentHp).toBe(3);
  });

  test("restored HP is capped at the killer's max HP", () => {
    const { game, killer, victim } = deployKillerAndVictim();
    killer.currentHp = killer.card.maxHp;

    LifecycleEngine.killUnit(game, victim, { sourceId: killer.id, sourceOwner: "Alice" });

    expect(killer.currentHp).toBe(killer.card.maxHp);
  });

  test("a killer without Bloodthirsty is not healed", () => {
    const game = setupGameWithHands({ Alice: ["Test Filler 1"], Bob: ["Test Filler 2"] });
    const killer = deployUnit(game, "Alice", "Test Filler 1", "fisherman");
    const victim = deployUnit(game, "Bob", "Test Filler 2", "fisherman");
    killer.currentHp = 1;

    LifecycleEngine.killUnit(game, victim, { sourceId: killer.id, sourceOwner: "Alice" });

    expect(killer.currentHp).toBe(1);
  });

  test("an Undying save prevents the kill and the heal", () => {
    const game = setupGameWithHands({ Alice: ["Test Bloodthirsty Unit"], Bob: ["Test Trait Unit"] });
    const killer = deployUnit(game, "Alice", "Test Bloodthirsty Unit", "fisherman");
    const undying = deployUnit(game, "Bob", "Test Trait Unit", "fisherman");
    killer.currentHp = 1;

    const result = LifecycleEngine.killUnit(game, undying, { sourceId: killer.id, sourceOwner: "Alice" });

    expect(result.undyingSaved).toBe(true);
    expect(undying.currentHp).toBe(1);
    expect(killer.currentHp).toBe(1);
  });

  test("a Silenced killer's Bloodthirsty does not heal", () => {
    const { game, killer, victim } = deployKillerAndVictim();
    killer.currentHp = 1;
    new RemoveTraitsHandler().execute({ targetId: killer.id }, { emitChild: () => {} }, game);
    expect(game.modifierStack.getEffective(killer.id, "trait", "bloodthirsty")).toBe(0);

    LifecycleEngine.killUnit(game, victim, { sourceId: killer.id, sourceOwner: "Alice" });

    expect(killer.currentHp).toBe(1);
  });

  test("a kill by a source that is not a unit grants no heal", () => {
    const { game, killer, victim } = deployKillerAndVictim();
    killer.currentHp = 1;

    LifecycleEngine.killUnit(game, victim, { sourceId: "Skill#not-a-unit", sourceOwner: "Alice" });

    expect(killer.currentHp).toBe(1);
  });
});
