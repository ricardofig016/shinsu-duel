/**
 * Map-backed serialized state and diff-based replay.
 *
 * Map-backed state (`cardsPlayedThisRound`, `repeatPlays`) serializes in the
 * engine's insertion order, which is itself deterministic: the maps are
 * cleared at their round/turn boundaries and re-appended in play order. The
 * replay reconstruction rebuilds object keys in event order, so a serializer
 * that canonicalized the order would break byte-for-byte verification for any
 * game whose plays occur in non-alphabetical order.
 */

import ReplayDriver from "../../replay/ReplayDriver.js";
import { setupGameWithHands, cards } from "../utils.js";

function deployScout(game, username) {
  game.processAction({
    type: "deploy-unit-action",
    data: {
      source: "player",
      username,
      handId: game.playerStates[username].hand.findIndex((c) => c.name === "Test Scout"),
      placedPositionCode: "scout",
    },
  });
}

describe("map-backed state ordering in replay", () => {
  test("serializes played-card keys in engine insertion order", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Scout"] });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    deployScout(game, "Bob"); // Bob plays first this round
    deployScout(game, "Alice");

    expect(Object.keys(game.toSerializedState().cardsPlayedThisRound)).toEqual(["Bob", "Alice"]);
  });

  test("replays a round with non-alphabetical play order byte-for-byte", () => {
    const game = setupGameWithHands({ Alice: ["Test Scout"], Bob: ["Test Scout"] });
    game.processAction({ type: "pass-turn-action", data: { source: "player", username: "Alice" } });
    deployScout(game, "Bob");
    deployScout(game, "Alice");

    const replayed = ReplayDriver.replay(game.logger.getReplayLog(), { cards });
    expect(JSON.stringify(replayed.toSerializedState())).toBe(JSON.stringify(game.toSerializedState()));
  });
});
