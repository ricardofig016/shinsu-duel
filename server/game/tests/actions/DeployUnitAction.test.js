import { advanceToRound, setupGameWithCardsInHand } from "../utils.js";
import { jest } from "@jest/globals";
import EVT from "../../EventCatalog.js";

const USERNAMES = ["Alice", "Bob"];

describe("place cards on field", () => {
  test("placing a scout unit puts it in the frontline", () => {
    // Test Scout is a scout
    const game = setupGameWithCardsInHand(["Test Scout", "Test Scout", "Test Scout", "Test Scout"]);

    // Deploy Monkeyman as a scout
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "scout" },
    });

    // Check that the card is on the field in the frontline
    const playerState = game.playerStates[USERNAMES[0]];
    expect(playerState.field.frontline.length).toBe(1);
    expect(playerState.field.backline.length).toBe(0);
    expect(playerState.field.frontline[0].card.name).toBe("Test Scout");
    expect(playerState.field.frontline[0].placedPositionCode).toBe("scout");
    expect(playerState.hand.length).toBe(4); // 5 initial - 1 deployed = 4
  });

  test("placing a light-bearer unit puts it in the backline", () => {
    // Test Light Bearer is a light-bearer
    const game = setupGameWithCardsInHand(["Test Light Bearer", "Test Light Bearer", "Test Light Bearer", "Test Light Bearer"]);

    // Deploy Rachel as a light-bearer
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "light-bearer" },
    });

    // Check that the card is on the field in the backline
    const playerState = game.playerStates[USERNAMES[0]];
    expect(playerState.field.backline.length).toBe(1);
    expect(playerState.field.frontline.length).toBe(0);
    expect(playerState.field.backline[0].card.name).toBe("Test Light Bearer");
    expect(playerState.field.backline[0].placedPositionCode).toBe("light-bearer");
    expect(playerState.hand.length).toBe(4); // 5 initial - 1 deployed = 4
  });

  test("deploying a unit costs shinsu", () => {
    // Test Expensive Unit costs 9 shinsu
    const game = setupGameWithCardsInHand(["Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit"]);

    // Fast-forward to round 10 (enough shinsu for 9-cost card)
    advanceToRound(game, 10);

    // Get initial shinsu state
    const initialShinsu = { ...game.playerStates[USERNAMES[0]].shinsu };

    // Deploy Evankhell
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "wave-controller" },
    });

    // Check that shinsu was spent
    const finalShinsu = game.playerStates[USERNAMES[0]].shinsu;
    const cardCost = 9; // Test Expensive Unit's cost

    // The cost is first deducted from recharged shinsu, then from normal available
    const expectedRechargedSpent = Math.min(initialShinsu.recharged, cardCost);
    const expectedNormalSpent = cardCost - expectedRechargedSpent;

    expect(finalShinsu.recharged).toBe(initialShinsu.recharged - expectedRechargedSpent);
    expect(finalShinsu.normalAvailable).toBe(initialShinsu.normalAvailable - expectedNormalSpent);
    expect(finalShinsu.normalSpent).toBe(initialShinsu.normalSpent + expectedNormalSpent);
  });

  test("deploying a unit with multiple position options works for all valid positions", () => {
    // Test Expensive Unit can be placed as wave-controller or fisherman
    const game = setupGameWithCardsInHand(["Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit"]);

    // Fast-forward to round 10
    advanceToRound(game, 10);

    // Try as fisherman first
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "fisherman" },
    });

    // Reset for second test with another game instance
    const game2 = setupGameWithCardsInHand(["Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit"]);

    // Fast-forward to round 10
    advanceToRound(game2, 10);

    // Try as wave-controller
    game2.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "wave-controller" },
    });

    // Both placements should succeed
    expect(game.playerStates[USERNAMES[0]].field.frontline[0].placedPositionCode).toBe("fisherman");
    expect(game2.playerStates[USERNAMES[0]].field.frontline[0].placedPositionCode).toBe("wave-controller");
  });

  test("deploying a unit to invalid position throws error", () => {
    // Test Light Bearer Only is only a light-bearer, not a fisherman
    const game = setupGameWithCardsInHand(["Test Light Bearer Only", "Test Light Bearer Only", "Test Light Bearer Only", "Test Light Bearer Only"]);

    // Fast-forward to round 2
    advanceToRound(game, 2);

    // Should throw error when trying to place as fisherman
    expect(() =>
      game.processAction({
        type: "deploy-unit-action",
        data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "fisherman" },
      })
    ).toThrow(/Card cannot be placed in position/);
  });

  test("deploying a unit without enough shinsu throws error", () => {
    // Test Expensive Unit costs 9 shinsu, too much for round 1
    const game = setupGameWithCardsInHand(["Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit", "Test Expensive Unit"]);

    // Make sure it's round 1 with only 1 shinsu
    expect(game.round).toBe(1);

    // Should throw error when trying to deploy expensive unit
    expect(() =>
      game.processAction({
        type: "deploy-unit-action",
        data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "wave-controller" },
      })
    ).toThrow(/Not enough shinsu/);
  });

  test("deploying a unit emits events and switches turns", () => {
    // Test Spear Bearer is a spear-bearer, costs 2 shinsu
    const game = setupGameWithCardsInHand(["Test Spear Bearer", "Test Spear Bearer", "Test Spear Bearer", "Test Spear Bearer"]);

    // Need at least round 2 for 2 shinsu
    advanceToRound(game, 2);
    const emitSpy = jest.spyOn(game.eventBus, "emit");

    // Initial turn state
    expect(game.currentTurn).toBe(USERNAMES[0]);

    // Deploy Rak
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "spear-bearer" },
    });

    // Check events were emitted
    expect(emitSpy).toHaveBeenCalledWith(EVT.UNIT_DEPLOYED, expect.any(Object));
    expect(emitSpy).toHaveBeenCalledWith(EVT.UNIT_SUMMONED, expect.any(Object));
    expect(emitSpy).toHaveBeenCalledWith(EVT.TURN_END, expect.any(Object));
    expect(emitSpy).toHaveBeenCalledWith(EVT.TURN_START, expect.any(Object));

    // Check turn switched
    expect(game.currentTurn).toBe(USERNAMES[1]);
  });
});
