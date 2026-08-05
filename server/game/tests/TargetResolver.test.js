import TargetResolver from "../TargetResolver.js";
import { createTestGame, getCardIdByName } from "./utils.js";

describe("TargetResolver", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
    // Ensure modifierStack.has returns false for all checks
    game.modifierStack.has = () => false;
  });

  test("resolve 'self' returns source unit", () => {
    const allyUnit = { id: "ally1", owner: game.usernames[0], isAlive: () => true, placedPositionCode: "scout", card: { rank: "regular" } };
    game.playerStates[game.usernames[0]].field.frontline = [allyUnit];

    const targets = TargetResolver.resolveTargets(game, {
      target: "self",
      sourceUnit: allyUnit,
    });
    expect(targets).toHaveLength(1);
    expect(targets[0].id).toBe("ally1");
  });

  test("resolve 'all_enemies' when frontline non-empty", () => {
    const allyUnit = { id: "ally1", owner: game.usernames[0], isAlive: () => true, placedPositionCode: "scout", card: { rank: "regular" } };
    const enemyFront = { id: "enemy1", owner: game.usernames[1], isAlive: () => true, placedPositionCode: "fisherman", card: { rank: "regular" } };
    const enemyBack = { id: "enemy2", owner: game.usernames[1], isAlive: () => true, placedPositionCode: "spear-bearer", card: { rank: "regular" } };

    game.playerStates[game.usernames[0]].field.frontline = [allyUnit];
    game.playerStates[game.usernames[1]].field.frontline = [enemyFront];
    game.playerStates[game.usernames[1]].field.backline = [enemyBack];

    const targets = TargetResolver.resolveTargets(game, {
      target: "all_enemies",
      sourceUnit: allyUnit,
    });

    expect(targets.length).toBe(1); // only frontline reachable
    expect(targets[0].id).toBe("enemy1");
  });

  test("resolve 'all_enemies' includes backline when frontline empty", () => {
    const allyUnit = { id: "ally1", owner: game.usernames[0], isAlive: () => true, placedPositionCode: "scout", card: { rank: "regular" } };
    const enemyBack = { id: "enemy2", owner: game.usernames[1], isAlive: () => true, placedPositionCode: "spear-bearer", card: { rank: "regular" } };

    game.playerStates[game.usernames[0]].field.frontline = [allyUnit];
    game.playerStates[game.usernames[1]].field.frontline = [];
    game.playerStates[game.usernames[1]].field.backline = [enemyBack];

    const targets = TargetResolver.resolveTargets(game, {
      target: "all_enemies",
      sourceUnit: allyUnit,
    });

    expect(targets.length).toBe(1); // backline now reachable
    expect(targets[0].id).toBe("enemy2");
  });
});
