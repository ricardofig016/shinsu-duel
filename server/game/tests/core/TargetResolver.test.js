import TargetResolver from "../../TargetResolver.js";
import { createTestGame, getCardIdByName } from "../utils.js";

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

  test("Taunt requires all targetable taunters before other enemies in a multi-target choice", () => {
    const source = { id: "source", owner: "Alice", isAlive: () => true, card: { rank: "regular" } };
    const taunter = { id: "taunter", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const otherEnemy = { id: "other", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => id === "taunter" && type === "trait" && key === "taunt";

    expect(() => TargetResolver.validateTauntSelection(
      [taunter, otherEnemy], [otherEnemy.id], game, source
    )).toThrow(/Taunt/);
    expect(TargetResolver.validateTauntSelection(
      [taunter, otherEnemy], [taunter.id, otherEnemy.id], game, source
    )).toBe(true);
  });

  test("Taunt does not constrain targetable skills without a source unit", () => {
    const taunter = { id: "taunter", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const otherEnemy = { id: "other", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => id === "taunter" && type === "trait" && key === "taunt";

    expect(TargetResolver.validateTauntSelection(
      [taunter, otherEnemy], [otherEnemy.id], game, null
    )).toBe(true);
  });
});

describe("TargetResolver.resolveCardTarget", () => {
  test("returns null for empty hand", () => {
    const state = { hand: [] };
    expect(TargetResolver.resolveCardTarget(state, "anything")).toBeNull();
    expect(TargetResolver.resolveCardTarget(null, "anything")).toBeNull();
    expect(TargetResolver.resolveCardTarget({ hand: [] }, null)).toBeNull();
  });

  test("resolves by exact card name (case-insensitive)", () => {
    const card = { id: "card#1", name: "Fiery Elephant", cost: 2 };
    const state = { hand: [card] };
    expect(TargetResolver.resolveCardTarget(state, "Fiery Elephant")).toBe("card#1");
    expect(TargetResolver.resolveCardTarget(state, "fiery elephant")).toBe("card#1");
    expect(TargetResolver.resolveCardTarget(state, "Nonexistent")).toBeNull();
  });

  test("resolves 'the most expensive card'", () => {
    const cheap = { id: "card#1", name: "A", cost: 1 };
    const expensive = { id: "card#2", name: "B", cost: 5 };
    const state = { hand: [cheap, expensive] };
    expect(TargetResolver.resolveCardTarget(state, "the most expensive card")).toBe("card#2");
  });

  test("resolves 'a <attribute>' selector", () => {
    const hwayeomsa = { id: "card#1", name: "Yeon Yihwa", cost: 2, attributes: ["hwayeomsa"] };
    const other = { id: "card#2", name: "Monkeyman", cost: 1, attributes: [] };
    const state = { hand: [other, hwayeomsa] };
    expect(TargetResolver.resolveCardTarget(state, "a Hwayeomsa")).toBe("card#1");
    expect(TargetResolver.resolveCardTarget(state, "a hwayeomsa")).toBe("card#1");
    expect(TargetResolver.resolveCardTarget(state, "a Nonexistent")).toBeNull();
  });
});
