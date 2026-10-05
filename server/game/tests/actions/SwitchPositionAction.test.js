import { setupGameWithCardsInHand, advanceToRound } from "../utils.js";
import LifecycleEngine from "../../services/LifecycleEngine.js";
import CombatSlotService from "../../services/CombatSlotService.js";
import EVT from "../../EventCatalog.js";

describe("switch-position-action", () => {
  function deployScoutThenWave(game) {
    // Deploy Test Scout (scout) as scout.
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "scout" },
    });
    return game.playerStates.Alice.field.frontline[0];
  }

  test("moves a unit between lines and updates placedPositionCode", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
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
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
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

  test("rejects switching a unit the player does not own", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Bob";
    game.playerStates.Bob.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };

    expect(() =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Bob", unitId: unit.id, positionCode: "fisherman" },
      })
    ).toThrow("Unit must be deployed on your field");
  });

  test("rejects switching a rooted unit", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";
    game.modifierStack.apply({
      sourceId: "System", sourceType: "system", targetId: unit.id,
      type: "condition", key: "rooted", value: 1,
    });

    expect(() =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "fisherman" },
      })
    ).toThrow("Rooted");
  });

  test("rejects an unknown position code", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";

    expect(() =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "not-a-position" },
      })
    ).toThrow("Invalid position");
  });

  test("rejects a position the unit cannot occupy", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";

    expect(() =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "light-bearer" },
      })
    ).toThrow("Unit cannot be placed in position");
  });

  test("spends the combat slot of the position it leaves", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";

    game.processAction({
      type: "switch-position-action",
      data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "fisherman" },
    });

    const slots = game.playerStates.Alice;
    expect(CombatSlotService.isAvailable(slots, "scout")).toBe(false);
    // Arriving somewhere spends nothing: the destination's slot survives the switch.
    expect(CombatSlotService.isAvailable(slots, "fisherman")).toBe(true);
  });

  test("rejects a switch out of a position whose combat slot is spent", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";
    CombatSlotService.consume(game.playerStates.Alice, "scout");

    expect(() =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "fisherman" },
      })
    ).toThrow("Combat slot for scout is already spent this round");

    // Validation is side-effect free: the unit stayed put and the turn was not spent.
    expect(unit.placedPositionCode).toBe("scout");
    expect(game.playerStates.Alice.field.frontline).toContain(unit);
    expect(game.currentTurn).toBe("Alice");
  });

  test("allows a switch into a position whose combat slot is spent", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";
    CombatSlotService.consume(game.playerStates.Alice, "fisherman");

    game.processAction({
      type: "switch-position-action",
      data: { source: "player", username: "Alice", unitId: unit.id, positionCode: "fisherman" },
    });

    const slots = game.playerStates.Alice;
    expect(unit.placedPositionCode).toBe("fisherman");
    // The spent destination stays spent, and the departure is spent by the switch.
    expect(CombatSlotService.isAvailable(slots, "fisherman")).toBe(false);
    expect(CombatSlotService.isAvailable(slots, "scout")).toBe(false);
  });

  test("reports the pre-existing refusals ahead of a spent departure slot", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
    advanceToRound(game, 2);
    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const unit = deployScoutThenWave(game);
    game.currentTurn = "Alice";
    CombatSlotService.consume(game.playerStates.Alice, "scout");

    const attempt = (positionCode) =>
      game.processAction({
        type: "switch-position-action",
        data: { source: "player", username: "Alice", unitId: unit.id, positionCode },
      });

    expect(() => attempt("not-a-position")).toThrow("Invalid position");
    expect(() => attempt("light-bearer")).toThrow("Unit cannot be placed in position");
    expect(() => attempt("scout")).toThrow("already in that position");
    expect(() => attempt("fisherman")).toThrow("Combat slot for scout is already spent this round");
  });

  test("LifecycleEngine.switchPosition throws when the unit is not on its line", () => {
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);
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
