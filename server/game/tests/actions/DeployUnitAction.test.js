import { advanceToRound, setupGameWithCardsInHand } from "../utils.js";
import { jest } from "@jest/globals";

const USERNAMES = ["Alice", "Bob"];

describe("place cards on field", () => {
  test("placing a scout unit puts it in the frontline", () => {
    // Ship is a scout (card id 4)
    const game = setupGameWithCardsInHand([4, 4, 4, 4]);

    // Deploy Ship as a scout
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "scout" },
    });

    // Check that the card is on the field in the frontline
    const playerState = game.playerStates[USERNAMES[0]];
    expect(playerState.field.frontline.length).toBe(1);
    expect(playerState.field.backline.length).toBe(0);
    expect(playerState.field.frontline[0].card.cardId).toBe(4); // Ship's ID
    expect(playerState.field.frontline[0].placedPositionCode).toBe("scout");
    expect(playerState.hand.length).toBe(3); // One card removed from hand
  });

  test("placing a lightbearer unit puts it in the backline", () => {
    // Rachel is a lightbearer (card id 6)
    const game = setupGameWithCardsInHand([6, 6, 6, 6]);

    // Deploy Rachel as a lightbearer
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "lightbearer" },
    });

    // Check that the card is on the field in the backline
    const playerState = game.playerStates[USERNAMES[0]];
    expect(playerState.field.backline.length).toBe(1);
    expect(playerState.field.frontline.length).toBe(0);
    expect(playerState.field.backline[0].card.cardId).toBe(6); // Rachel's id
    expect(playerState.field.backline[0].placedPositionCode).toBe("lightbearer");
    expect(playerState.hand.length).toBe(3); // One card removed from hand
  });

  test("deploying a unit costs shinsu", () => {
    // Evankell costs 8 shinsu (card id 5)
    const game = setupGameWithCardsInHand([5, 5, 5, 5]);

    // Fast-forward to round 6
    advanceToRound(game, 6);

    // Get initial shinsu state
    const initialShinsu = { ...game.playerStates[USERNAMES[0]].shinsu };

    // Deploy Evankell
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "wavecontroller" },
    });

    // Check that shinsu was spent
    const finalShinsu = game.playerStates[USERNAMES[0]].shinsu;
    const cardCost = 8; // Evankell's cost

    // The cost is first deducted from recharged shinsu, then from normal available
    const expectedRechargedSpent = Math.min(initialShinsu.recharged, cardCost);
    const expectedNormalSpent = cardCost - expectedRechargedSpent;

    expect(finalShinsu.recharged).toBe(initialShinsu.recharged - expectedRechargedSpent);
    expect(finalShinsu.normalAvailable).toBe(initialShinsu.normalAvailable - expectedNormalSpent);
    expect(finalShinsu.normalSpent).toBe(initialShinsu.normalSpent + expectedNormalSpent);
  });

  test("deploying a unit with multiple position options works for all valid positions", () => {
    // Evankhell (id 5) can be placed as wavecontroller or fisherman
    const game = setupGameWithCardsInHand([5, 5, 5, 5]);

    // Fast-forward to round 10
    advanceToRound(game, 10);

    // Try as fisherman first
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "fisherman" },
    });

    // Reset for second test with another game instance
    const game2 = setupGameWithCardsInHand([5, 5, 5, 5]);

    // Fast-forward to round 10
    advanceToRound(game2, 10);

    // Try as wavecontroller
    game2.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "wavecontroller" },
    });

    // Both placements should succeed
    expect(game.playerStates[USERNAMES[0]].field.frontline[0].placedPositionCode).toBe("fisherman");
    expect(game2.playerStates[USERNAMES[0]].field.frontline[0].placedPositionCode).toBe("wavecontroller");
  });

  test("deploying a unit to invalid position throws error", () => {
    // Khun (id 2) is only a lightbearer, not a fisherman
    const game = setupGameWithCardsInHand([2, 2, 2, 2]);

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
    // Viole costs 3 shinsu (id 0), too much for round 1
    const game = setupGameWithCardsInHand([0, 0, 0, 0]);

    // Make sure it's round 1 with only 1 shinsu
    expect(game.round).toBe(1);

    // Should throw error when trying to deploy expensive unit
    expect(() =>
      game.processAction({
        type: "deploy-unit-action",
        data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "wavecontroller" },
      })
    ).toThrow(/Not enough shinsu/);
  });

  test("deploying a unit publishes events and switches turns", () => {
    // Add spy to monitor event publishing
    const game = setupGameWithCardsInHand([3, 3, 3, 3]);

    // Create spies on the event bus
    const publishSpy = jest.spyOn(game.eventBus, "publish");

    // Initial turn state
    expect(game.currentTurn).toBe(USERNAMES[0]);

    // Deploy Rak
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: USERNAMES[0], handId: 0, placedPositionCode: "spearbearer" },
    });

    // Check events were published
    expect(publishSpy).toHaveBeenCalledWith("OnDeployUnit", expect.any(Object));
    expect(publishSpy).toHaveBeenCalledWith("OnSummonUnit", expect.any(Object));
    expect(publishSpy).toHaveBeenCalledWith("OnTurnEnd", expect.any(Object));
    expect(publishSpy).toHaveBeenCalledWith("OnTurnStart", expect.any(Object));

    // Check turn switched
    expect(game.currentTurn).toBe(USERNAMES[1]);
  });
});
