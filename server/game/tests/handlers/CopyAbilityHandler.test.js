import { setupGameWithHands, deployUnit } from "../utils.js";
import CopyAbilityHandler from "../../handlers/CopyAbilityHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("CopyAbilityHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new CopyAbilityHandler();
  });

  test("resolves the single ability of an enemy with one ability", () => {
    const game = setupGameWithHands({ Bob: ["Test Shinheuh"], Alice: ["Test Shinheuh"] });
    // Test Shinheuh has one ability: deal 3 to an enemy (quick).
    const source = deployUnit(game, "Bob", "Test Shinheuh", "frontline");
    const caster = deployUnit(game, "Alice", "Test Shinheuh", "frontline");

    const result = handler.execute(
      { sourceUnitId: source.id, sourceId: caster.id, sourceUnit: caster, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.used).toBe(true);
    // The copied "deal 3 to an enemy" targets Bob's Bull (Alice's enemy).
    expect(source.currentHp).toBe(0);
  });

  test("no-op when the enemy has no abilities", () => {
    const game = setupGameWithHands({ Bob: ["Test Shinheuh"] });
    const source = deployUnit(game, "Bob", "Test Shinheuh", "frontline");
    source.card.abilities = [];

    const result = handler.execute(
      { sourceUnitId: source.id, sourceId: "Unit#C", sourceUnit: { owner: "Alice" }, sourceOwner: "Alice" },
      context(game),
      game
    );
    expect(result.used).toBe(false);
  });

  test("defers to an ability_selection decision when the enemy has multiple abilities", () => {
    const game = setupGameWithHands({ Bob: ["Test Multi Position"], Alice: ["Test Shinheuh"] });
    // Test Multi Position has two abilities (deal 3 to a frontline enemy, heal enemy Conduit).
    const source = deployUnit(game, "Bob", "Test Multi Position", "fisherman");
    const caster = deployUnit(game, "Alice", "Test Shinheuh", "frontline");

    const result = handler.execute(
      { sourceUnitId: source.id, sourceId: caster.id, sourceUnit: caster, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.used).toBe(true);
    expect(result.pending).toBe(true);
    expect(game.pendingDecision.type).toBe("ability_selection");
    expect(game.pendingDecision.candidates).toHaveLength(2);
  });

  test("validate throws without sourceUnitId", () => {
    expect(() => handler.validate({})).toThrow("sourceUnitId");
  });
});
