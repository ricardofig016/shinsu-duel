import { setupGameWithCardsInHand, advanceToRound } from "../utils.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import EVT from "../../EventCatalog.js";

describe("switch-position-action", () => {
  function deployScoutThenWave(game) {
    // Deploy Monkeyman (scout) as scout.
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    return game.playerStates.Alice.field.frontline[0];
  }

  test("moves a unit between lines and updates placedPositionCode", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Monkeyman", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };

    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";

    const emitted = [];
    game.eventBus.on(EVT.UNIT_POSITION_SWITCHED, (p) => emitted.push(p), { phase: "post" });

    game.processAction({
      type: "switch-position-action",
      data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "fisherman" },
    });

    expect(unit.placedPositionCode).toBe("fisherman");
    expect(game.playerStates.Alice.field.frontline).toContain(unit);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].unitId).toBe(unit.id);
    // Action ends the turn.
    expect(game.currentTurn).toBe("Bob");
  });

  test("rejects switching to the same position", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Monkeyman", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";

    expect(() =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "scout" },
      })
    ).toThrow("already in that position");
  });

  test("LifecycleEngine.switchPosition throws when the unit is not on its line", () => {
    const game = setupGameWithCardsInHand(["Monkeyman", "Monkeyman", "Monkeyman", "Monkeyman"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);

    // Remove the unit from the field to simulate a stale reference.
    game.playerStates.Alice.field.frontline.splice(0, 1);
    expect(() =>
      LifecycleEngine.switchPosition(game, unit, "fisherman")
    ).toThrow("not on its expected line");
  });
});
