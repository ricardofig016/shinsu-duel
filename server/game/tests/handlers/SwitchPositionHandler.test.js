import { setupGameWithHands, deployUnit } from "../utils.js";
import SwitchPositionHandler from "../../handlers/SwitchPositionHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("SwitchPositionHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new SwitchPositionHandler();
  });

  test("forces an enemy to its other printed position", () => {
    const game = setupGameWithHands({ Bob: ["Test Multi Position II"] });
    const unit = deployUnit(game, "Bob", "Test Multi Position II", "fisherman");

    const result = handler.execute(
      { targetId: unit.id, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.switched).toBe(true);
    expect(unit.placedPositionCode).toBe("spear-bearer");
    expect(game.playerStates.Bob.field.backline).toContain(unit);
  });

  test("no-op when no legal destination position exists", () => {
    const game = setupGameWithHands({ Bob: ["Test Shinheuh"] });
    // A shinheuh carries no printed position, so it has no legal destination.
    const unit = deployUnit(game, "Bob", "Test Shinheuh", "frontline");

    const result = handler.execute(
      { targetId: unit.id, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.switched).toBe(false);
    expect(unit.placedPositionCode).toBe(null);
  });

  test("no-op for a Rooted unit", () => {
    const game = setupGameWithHands({ Bob: ["Test Multi Position II"] });
    const unit = deployUnit(game, "Bob", "Test Multi Position II", "fisherman");
    game.modifierStack.apply({
      sourceId: "System", sourceType: "system", targetId: unit.id,
      type: "condition", key: "rooted", value: 1,
    });

    const result = handler.execute({ targetId: unit.id, sourceOwner: "Alice" }, context(game), game);
    expect(result.switched).toBe(false);
    expect(unit.placedPositionCode).toBe("fisherman");
  });

  test("no-op when the destination line is full", () => {
    const game = setupGameWithHands({ Bob: ["Test Multi Position II"] });
    const unit = deployUnit(game, "Bob", "Test Multi Position II", "fisherman");
    // Fill Bob's backline (spear-bearer) to capacity so there is no room to switch.
    game.playerStates.Bob.field.backline = [
      { id: "B1", card: { name: "A" }, currentHp: 1 },
      { id: "B2", card: { name: "B" }, currentHp: 1 },
      { id: "B3", card: { name: "C" }, currentHp: 1 },
      { id: "B4", card: { name: "D" }, currentHp: 1 },
      { id: "B5", card: { name: "E" }, currentHp: 1 },
    ];

    const result = handler.execute({ targetId: unit.id, sourceOwner: "Alice" }, context(game), game);

    expect(result).toEqual({ switched: false, reason: "no legal position" });
    expect(unit.placedPositionCode).toBe("fisherman");
  });

  test("defers to a position_selection decision when multiple legal destinations exist", () => {
    const game = setupGameWithHands({ Bob: ["Test Evolve Unit"] });
    // Test Evolve Unit has three printed positions (fisherman, scout, wave controller).
    const unit = deployUnit(game, "Bob", "Test Evolve Unit", "fisherman");

    const result = handler.execute(
      { targetId: unit.id, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.switched).toBe(true);
    expect(result.pending).toBe(true);
    expect(game.pendingDecision.type).toBe("position_selection");
    expect(game.pendingDecision.candidates.map((c) => c.id).sort())
      .toEqual(["scout", "wave-controller"]);
  });

  test("validate throws without targetId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
  });
});
