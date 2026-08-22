import { setupGameWithHands, deployUnit } from "../utils.js";
import SlayHandler from "../../handlers/SlayHandler.js";
import EVT from "../../EventCatalog.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("SlayHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new SlayHandler();
  });

  test("kills an alive target through the lethal pipeline", () => {
    const game = setupGameWithHands({ Bob: ["Test Shinheuh"] });
    const target = deployUnit(game, "Bob", "Test Shinheuh", "frontline-shinheuh");

    const killed = [];
    game.eventBus.on(EVT.UNIT_KILLED, (p) => killed.push(p.targetId), { phase: "post" });

    const result = handler.execute(
      { targetId: target.id, sourceId: "Unit#Attacker", sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.slayed).toBe(true);
    expect(game._findUnit(target.id)).toBeNull();
    expect(killed).toContain(target.id);
  });

  test("Undying intercepts and saves a Slayed unit", () => {
    const game = setupGameWithHands({ Bob: ["Test Shinheuh"] });
    const target = deployUnit(game, "Bob", "Test Shinheuh", "frontline-shinheuh");

    game.modifierStack.apply({
      sourceId: "System", sourceType: "system", targetId: target.id,
      type: "trait", key: "undying", value: 1,
    });

    const result = handler.execute(
      { targetId: target.id, sourceId: "Unit#Attacker", sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.slayed).toBe(false);
    expect(result.undyingSaved).toBe(true);
    expect(game._findUnit(target.id).currentHp).toBe(1);
  });

  test("no-op when the target is not found", () => {
    const game = setupGameWithHands({ Bob: ["Test Shinheuh"] });
    expect(handler.execute({ targetId: "Unit#Missing", sourceId: "S" }, context(game), game))
      .toEqual({ slayed: false });
  });

  test("validate throws without a targetId", () => {
    expect(() => handler.validate({})).toThrow("targetId");
  });
});
