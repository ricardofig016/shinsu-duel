import ReplayDriver from "../../replay/ReplayDriver.js";
import { advanceToRound, cards, setupGameWithHands } from "../utils.js";

const CONDITION_KEYS = ["burned", "exhausted", "weak"];

// The full Conduit scenario driven exclusively through player actions, so the
// Logger's replay log captures every state change: Bob fields a backline unit
// as the Baang target (his frontline stays empty, keeping the backline
// Conduit targetable), Alice deploys the Jeonsulsa unit (summoning the
// Conduit), the next round start plays one Baang, and Khun Ran's
// heal-and-activate ability plays two more.
//
// The scenario deliberately attaches no extra bus subscriptions: every
// handler registration consumes a GameClock tick, so an observer that only
// exists on the original run would desynchronize its serialized clock from
// the replayed game and break replay equality.
function runScenario() {
  const game = setupGameWithHands({ Alice: ["Test Khun Ran"], Bob: ["Test Light Bearer"] });

  // Deploying ends the turn, so each deployment is followed by the opposing
  // player's action and Bob's pre-deploy pass is split around it.
  game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
  const bearerHandId = game.playerStates.Bob.hand.findIndex((c) => c.name === "Test Light Bearer");
  game.processAction({
    type: "deploy-unit-action",
    data: { source: "player", username: "Bob", handId: bearerHandId, placedPositionCode: "light-bearer" },
  });
  game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
  game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });

  advanceToRound(game, 3);
  const ranHandId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Khun Ran");
  game.processAction({
    type: "deploy-unit-action",
    data: { source: "player", username: "Alice", handId: ranHandId, placedPositionCode: "fisherman" },
  });

  advanceToRound(game, 4);
  // Round 4 starts on Bob's turn; he passes so Alice can use her ability.
  game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Bob" } });

  const ran = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Test Khun Ran");
  game.processAction({
    type: "use-ability-action",
    data: { source: "player", username: "Alice", unitId: ran.id, abilityCode: "1" },
  });

  return game;
}

function findUnit(game, username, cardName) {
  const field = game.playerStates[username].field;
  return [...field.frontline, ...field.backline].find((u) => u.card.name === cardName);
}

// The observable Baang outcome: the Conduit's entry state, its Ghost, and the
// ordered condition applications on the Baang target (each Baang's
// give_condition lands here, so the sequence identifies the selections).
function baangOutcome(game) {
  const conduit = findUnit(game, "Bob", "Conduit");
  const bearer = findUnit(game, "Bob", "Test Light Bearer");
  return {
    conduitHp: conduit.currentHp,
    conduitMaxHp: conduit.card.maxHp,
    ghost: game.modifierStack.has(conduit.id, "condition", "ghost"),
    bearerConditions: game.modifierStack.getModifiers(bearer.id, "condition").map((m) => ({ key: m.key, value: m.value })),
    conditionTotals: CONDITION_KEYS.map((key) => game.modifierStack.getEffective(bearer.id, "condition", key)),
  };
}

describe("Jeonsulsa determinism and replay", () => {
  test("the same seed reproduces identical Baang selections, ally targets, and conditions across runs", () => {
    const firstGame = runScenario();
    const secondGame = runScenario();

    const first = baangOutcome(firstGame);
    const second = baangOutcome(secondGame);

    // The Conduit was healed (2 → 4) and Ghosted; three Baangs landed on the
    // only other friendly unit.
    expect(first.conduitHp).toBe(4);
    expect(first.conduitMaxHp).toBe(8);
    expect(first.ghost).toBe(true);
    expect(first.bearerConditions.length).toBeGreaterThanOrEqual(3);
    for (const total of first.conditionTotals) expect(total).toBeGreaterThanOrEqual(0);
    expect(first.conditionTotals.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(3);

    expect(second).toEqual(first);
  });

  test("ReplayDriver reproduces the scenario byte-for-byte, RNG position included", () => {
    const game = runScenario();

    const replayLog = game.logger.getReplayLog();
    const replayed = ReplayDriver.replay(replayLog, { cards });

    // ReplayDriver asserts full serialized state equality after every recorded
    // step; the final states must match, RNG position included.
    expect(replayed.toSerializedState()).toEqual(game.toSerializedState());
    expect(replayed._rng.getState()).toEqual(game._rng.getState());

    // The Baang outcomes are identical between the original and replayed run.
    expect(baangOutcome(replayed)).toEqual(baangOutcome(game));
  });
});
