import EVT from "../../../EventCatalog.js";
import { debugAction, deployUnit, setupGameWithHands } from "../../utils.js";

const destroyUnit = (game, unitId) => game.processAction(debugAction("debug-destroy-unit-action", { unitId }));

const scoutGame = () => setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Scout"] });

describe("DebugDestroyUnitAction", () => {
  test("destroys a deployed unit through the lifecycle engine", () => {
    const game = scoutGame();
    const destroyed = [];
    game.eventBus.on(EVT.UNIT_DESTROYED, (payload) => destroyed.push(payload), { phase: "post" });
    const scout = deployUnit(game, "Alice", "Test Scout", "scout");

    destroyUnit(game, scout.id);

    expect(game.playerStates.Alice.field.frontline).toHaveLength(0);
    expect(game._findUnit(scout.id)).toBeNull();
    expect(game.playerStates.Alice.discard.map((card) => card.name)).toEqual(["Test Scout"]);
    expect(destroyed).toHaveLength(1);
    expect(destroyed[0].unitId).toBe(scout.id);
  });

  test("destroys an opponent's unit as well", () => {
    const game = scoutGame();
    const scout = deployUnit(game, "Bob", "Test Scout", "scout");

    destroyUnit(game, scout.id);

    expect(game.playerStates.Bob.field.frontline).toHaveLength(0);
  });

  test("rejects an unknown unit, a unit already destroyed, and a player source", () => {
    const game = scoutGame();
    const scout = deployUnit(game, "Alice", "Test Scout", "scout");

    expect(() => destroyUnit(game, "unit-missing")).toThrow("Unit unit-missing is not on the field.");
    destroyUnit(game, scout.id);
    expect(() => destroyUnit(game, scout.id)).toThrow("is not on the field.");
    expect(() =>
      game.processAction({
        type: "debug-destroy-unit-action",
        data: { source: "player", requestedBy: "Bob", unitId: scout.id },
      })
    ).toThrow("Source player is not allowed to perform this action.");
  });
});
