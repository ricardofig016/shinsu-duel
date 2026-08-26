import ReplayDriver from "../../replay/ReplayDriver.js";
import { setupGameWithHands, advanceToRound, cards } from "../utils.js";

describe("landmark replay determinism", () => {
  test("replays a full landmark lifecycle to an identical state", () => {
    const game = setupGameWithHands({
      Alice: ["Test Name Hunt Station", "Test Landmark Rules"],
      Bob: ["Test Scout"],
    });
    advanceToRound(game, 4);

    // Alice deploys Name Hunt Station → position choice pending → resolved.
    const stationHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Name Hunt Station");
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: stationHandId, placedPositionCode: "backline" },
    });
    expect(game.pendingDecision.type).toBe("position_selection");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: ["scout"] });

    // Bob deploys a Scout into the chosen position → Rooted by the grant.
    const scoutHandId = game.playerStates.Bob.hand.findIndex((c) => c.name === "Test Scout");
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Bob", handId: scoutHandId, placedPositionCode: "scout" },
    });
    const bobScout = [...game.playerStates.Bob.field.frontline, ...game.playerStates.Bob.field.backline]
      .find((u) => u.card.name === "Test Scout");
    expect(game.modifierStack.has(bobScout.id, "condition", "rooted")).toBe(true);

    // Alice replaces the station → its rules and grants are revoked.
    const replacementHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Landmark Rules");
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: replacementHandId, placedPositionCode: "backline" },
    });
    expect(game.modifierStack.has(bobScout.id, "condition", "rooted")).toBe(false);

    const finalState = game.toSerializedState();
    const replayLog = game.logger.getReplayLog();
    const replayed = ReplayDriver.replay(replayLog, { cards });
    expect(replayed.toSerializedState()).toEqual(finalState);
  });

  test("replays a chosen-position landmark state with its choice intact", () => {
    const game = setupGameWithHands({
      Alice: ["Test Name Hunt Station"],
      Bob: ["Test Scout"],
    });
    advanceToRound(game, 2);

    const stationHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Name Hunt Station");
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Alice", handId: stationHandId, placedPositionCode: "backline" },
    });
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, username: "Alice", choices: ["scout"] });

    const scoutHandId = game.playerStates.Bob.hand.findIndex((c) => c.name === "Test Scout");
    game.processAction({
      type: "deploy-unit-action",
      data: { source: "player", username: "Bob", handId: scoutHandId, placedPositionCode: "scout" },
    });

    const finalState = game.toSerializedState();
    expect(finalState.players.Alice.backline[0].chosenPositionCode).toBe("scout");
    const replayed = ReplayDriver.replay(game.logger.getReplayLog(), { cards });
    expect(replayed.toSerializedState()).toEqual(finalState);
  });
});
