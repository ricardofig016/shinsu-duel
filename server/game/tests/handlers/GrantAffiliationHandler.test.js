import { setupGameWithHands, deployUnit } from "../utils.js";
import GrantAffiliationHandler from "../../handlers/GrantAffiliationHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("GrantAffiliationHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new GrantAffiliationHandler();
  });

  test("grants a native affiliation of the donor, tracked to the payload source", () => {
    const game = setupGameWithHands({ Alice: ["Test Affiliation Granter", "Test Affiliation Donor Fug"] });
    const granter = deployUnit(game, "Alice", "Test Affiliation Granter", "wave-controller");
    const donor = deployUnit(game, "Alice", "Test Affiliation Donor Fug", "scout");

    const result = handler.execute(
      { targetId: granter.id, sourceUnitId: donor.id, sourceId: "Ability#1", sourceType: "unit" },
      context(game),
      game
    );

    expect(result.granted).toBe(true);
    expect(result.affiliation).toBe("fug");
    expect(game.modifierStack.has(granter.id, "affiliation", "fug")).toBe(true);
    const [mod] = game.modifierStack.getModifiers(granter.id, "affiliation");
    expect(mod.sourceId).toBe("Ability#1");
    expect(mod.sourceType).toBe("unit");
    expect(mod.targetId).toBe(granter.id);
  });

  test("chains through a modifier-granted affiliation of the donor", () => {
    const game = setupGameWithHands({ Alice: ["Test Affiliation Granter", "Test Affiliation Donor Fug"] });
    const granter = deployUnit(game, "Alice", "Test Affiliation Granter", "wave-controller");
    const donor = deployUnit(game, "Alice", "Test Affiliation Donor Fug", "scout");

    // The granter holds no native affiliation, only a modifier-granted one —
    // the donor pool must include it like every affiliation reader does.
    game.modifierStack.apply({
      sourceId: granter.id,
      sourceType: "unit",
      targetId: granter.id,
      type: "affiliation",
      key: "wolhaiksong",
      value: 1,
      operation: "add",
    });

    const result = handler.execute(
      { targetId: donor.id, sourceUnitId: granter.id, sourceId: "Ability#2" },
      context(game),
      game
    );

    expect(result.granted).toBe(true);
    expect(result.affiliation).toBe("wolhaiksong");
    expect(game.modifierStack.has(donor.id, "affiliation", "wolhaiksong")).toBe(true);
  });

  test("returns a no-op when the donor's pool is empty", () => {
    const game = setupGameWithHands({ Alice: ["Test Affiliation Granter", "Test Affiliation Donor Fug"] });
    const granter = deployUnit(game, "Alice", "Test Affiliation Granter", "wave-controller");
    const donor = deployUnit(game, "Alice", "Test Affiliation Donor Fug", "scout");

    const result = handler.execute(
      { targetId: donor.id, sourceUnitId: granter.id, sourceId: "Ability#1" },
      context(game),
      game
    );

    expect(result).toEqual({ granted: false, reason: "no affiliation to copy" });
    expect(game.modifierStack.getModifiers(donor.id, "affiliation")).toHaveLength(0);
  });

  test("the grant is revoked with its source like any modifier", () => {
    const game = setupGameWithHands({ Alice: ["Test Affiliation Granter", "Test Affiliation Donor Fug"] });
    const granter = deployUnit(game, "Alice", "Test Affiliation Granter", "wave-controller");
    const donor = deployUnit(game, "Alice", "Test Affiliation Donor Fug", "scout");

    handler.execute(
      { targetId: granter.id, sourceUnitId: donor.id, sourceId: "Ability#1" },
      context(game),
      game
    );
    expect(game.modifierStack.has(granter.id, "affiliation", "fug")).toBe(true);

    game.modifierStack.removeBySource("Ability#1");
    expect(game.modifierStack.has(granter.id, "affiliation", "fug")).toBe(false);
  });

  test("validate requires targetId and sourceUnitId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
    expect(() => handler.validate({ targetId: "Unit#1" })).toThrow("sourceUnitId");
  });

  test("picks deterministically from a mixed pool for the same seed", () => {
    const run = () => {
      const game = setupGameWithHands({ Alice: ["Test Affiliation Granter", "Test Affiliation Donor Fug"] });
      const granter = deployUnit(game, "Alice", "Test Affiliation Granter", "wave-controller");
      const donor = deployUnit(game, "Alice", "Test Affiliation Donor Fug", "scout");
      // Mix the donor's pool: native fug + modifier-granted wolhaiksong.
      game.modifierStack.apply({
        sourceId: "Passive#1",
        sourceType: "passive",
        targetId: donor.id,
        type: "affiliation",
        key: "wolhaiksong",
        value: 1,
        operation: "add",
      });
      return handler.execute(
        { targetId: granter.id, sourceUnitId: donor.id, sourceId: "Ability#1" },
        context(game),
        game
      ).affiliation;
    };

    expect(["fug", "wolhaiksong"]).toContain(run());
    expect(run()).toBe(run());
  });
});
