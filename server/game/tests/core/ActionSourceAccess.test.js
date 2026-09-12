import createActionRegistry from "../../registries/actionRegistry.js";
import { createTestGame, debugAction } from "../utils.js";

/**
 * Source discipline between the player vocabulary and the dev console's.
 *
 * The gateway stamps `source: "player"` on `game-action` and `source: "debug"`
 * on `debug-action`, and each handler family admits exactly one of them, so
 * neither channel can reach the other's mutations however the payload is
 * shaped.
 */

const PLAYER_TYPES = [
  "deploy-unit-action",
  "pass-turn-action",
  "use-ability-action",
  "generate-fire-charge-action",
  "play-skill-action",
  "equip-equipment-action",
  "switch-position-action",
];

const DEBUG_TYPES = [
  "debug-draw-action",
  "debug-add-to-hand-action",
  "debug-add-to-deck-action",
  "debug-shuffle-deck-action",
  "debug-mulligan-action",
  "debug-grant-shinsu-action",
  "debug-end-round-action",
  "debug-force-turn-action",
  "debug-set-round-action",
  "debug-spawn-unit-action",
  "debug-unit-hp-action",
  "debug-destroy-unit-action",
  "debug-lighthouses-action",
];

describe("action source access", () => {
  test("every player action rejects the debug source", () => {
    const registry = createActionRegistry();
    for (const type of PLAYER_TYPES) {
      expect(registry[type].constructor.sourceAccess.debug).toBe(false);
    }
  });

  test("every debug action rejects the player and system sources", () => {
    const registry = createActionRegistry();
    for (const type of DEBUG_TYPES) {
      expect(registry[type].constructor.sourceAccess).toEqual({
        player: false,
        debug: true,
        system: false,
      });
    }
  });

  test("both vocabularies are registered and disjoint", () => {
    const registry = createActionRegistry();
    expect(Object.keys(registry).sort()).toEqual([...PLAYER_TYPES, ...DEBUG_TYPES].sort());
  });

  test("a debug-stamped message cannot invoke a player action", () => {
    const game = createTestGame();

    expect(() =>
      game.processAction({
        type: "pass-turn-action",
        data: { source: "debug", requestedBy: "Bob", username: "Alice" },
      })
    ).toThrow("Source debug is not allowed to perform this action.");
    expect(game.currentTurn).toBe("Alice");
  });

  test("a player-stamped message cannot invoke a debug action", () => {
    const game = createTestGame();
    const handBefore = game.playerStates.Alice.hand.length;

    expect(() =>
      game.processAction({
        type: "debug-draw-action",
        data: { source: "player", requestedBy: "Bob", username: "Alice", amount: 1 },
      })
    ).toThrow("Source player is not allowed to perform this action.");
    expect(game.playerStates.Alice.hand).toHaveLength(handBefore);
  });

  test("a debug action's payload cannot smuggle fields outside its schema", () => {
    const game = createTestGame();

    expect(() =>
      game.processAction(debugAction("debug-force-turn-action", { source: "debug", free: true }))
    ).toThrow("Unexpected field: free");
  });

  test("debug actions require the issuer identity the gateway stamps", () => {
    const game = createTestGame();

    expect(() =>
      game.processAction({
        type: "debug-force-turn-action",
        data: { source: "debug" },
      })
    ).toThrow("Missing required field: requestedBy");
  });
});
