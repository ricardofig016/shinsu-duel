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

describe("TargetResolver.resolveTargets — remaining descriptors", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
    game.modifierStack.has = () => false;
  });

  function unit(id, owner, position = "scout", extra = {}) {
    return { id, owner, isAlive: () => true, placedPositionCode: position, card: { rank: "regular", ...extra }, ...extra };
  }

  test("'enemy_frontline' returns only living enemy frontline units", () => {
    const source = unit("s", game.usernames[0]);
    const enemyFront = unit("ef", game.usernames[1], "fisherman");
    const enemyBack = unit("eb", game.usernames[1], "spear-bearer");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [enemyFront];
    game.playerStates[game.usernames[1]].field.backline = [enemyBack];

    const targets = TargetResolver.resolveTargets(game, { target: "enemy_frontline", sourceUnit: source });
    expect(targets.map((t) => t.id)).toEqual(["ef"]);
  });

  test("'enemy_backline' returns only living enemy backline units", () => {
    const source = unit("s", game.usernames[0]);
    const enemyFront = unit("ef", game.usernames[1], "fisherman");
    const enemyBack = unit("eb", game.usernames[1], "spear-bearer");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [enemyFront];
    game.playerStates[game.usernames[1]].field.backline = [enemyBack];

    const targets = TargetResolver.resolveTargets(game, { target: "enemy_backline", sourceUnit: source });
    expect(targets.map((t) => t.id)).toEqual(["eb"]);
  });

  test("'all_allies' returns all living allied units", () => {
    const source = unit("s", game.usernames[0]);
    const allyFront = unit("af", game.usernames[0], "scout");
    const allyBack = unit("ab", game.usernames[0], "light-bearer");
    game.playerStates[game.usernames[0]].field.frontline = [source, allyFront];
    game.playerStates[game.usernames[0]].field.backline = [allyBack];

    const targets = TargetResolver.resolveTargets(game, { target: "all_allies", sourceUnit: source, count: 10 });
    expect(targets.map((t) => t.id)).toEqual(["s", "af", "ab"]);
  });

  test("'ally' excludes the source unit", () => {
    const source = unit("s", game.usernames[0]);
    const allyFront = unit("af", game.usernames[0], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source, allyFront];

    const targets = TargetResolver.resolveTargets(game, { target: "ally", sourceUnit: source });
    expect(targets.map((t) => t.id)).toEqual(["af"]);
  });

  test("'bearer' returns the source unit", () => {
    const source = unit("s", game.usernames[0]);
    game.playerStates[game.usernames[0]].field.frontline = [source];
    const targets = TargetResolver.resolveTargets(game, { target: "bearer", sourceUnit: source });
    expect(targets.map((t) => t.id)).toEqual(["s"]);
  });

  test("'unit' returns every living unit on the board", () => {
    const a = unit("a", game.usernames[0]);
    const b = unit("b", game.usernames[1]);
    const dead = unit("d", game.usernames[1], "scout", { isAlive: () => false });
    game.playerStates[game.usernames[0]].field.frontline = [a];
    game.playerStates[game.usernames[1]].field.frontline = [b, dead];

    const targets = TargetResolver.resolveTargets(game, { target: "unit", count: 10 });
    expect(targets.map((t) => t.id)).toEqual(["a", "b"]);
  });

  test("'enemy_lighthouses' yields a lighthouse when no living blockers", () => {
    const source = unit("s", game.usernames[0]);
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [];
    game.playerStates[game.usernames[1]].field.backline = [];

    const targets = TargetResolver.resolveTargets(game, { target: "enemy_lighthouses", sourceUnit: source });
    expect(targets).toHaveLength(1);
    expect(targets[0].type).toBe("lighthouse");
  });

  test("'enemy_lighthouses' is empty when a living blocker exists", () => {
    const source = unit("s", game.usernames[0]);
    const enemyFront = unit("ef", game.usernames[1], "fisherman");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [enemyFront];

    const targets = TargetResolver.resolveTargets(game, { target: "enemy_lighthouses", sourceUnit: source });
    expect(targets).toEqual([]);
  });

  test("throws on unknown descriptor", () => {
    expect(() => TargetResolver.resolveTargets(game, { target: "bogus" })).toThrow("unknown target descriptor");
  });

  test("throws when no target descriptor is provided", () => {
    expect(() => TargetResolver.resolveTargets(game, {})).toThrow("target descriptor is required");
  });

  test("'self' requires a source unit", () => {
    expect(() => TargetResolver.resolveTargets(game, { target: "self" })).toThrow("requires sourceUnit");
  });

  test("'ally' without source unit or owner throws", () => {
    expect(() => TargetResolver.resolveTargets(game, { target: "ally" })).toThrow("requires sourceUnit or sourceOwner");
  });

  test("applies condition filter", () => {
    const source = unit("s", game.usernames[0]);
    const burned = unit("b", game.usernames[1], "scout");
    const clean = unit("c", game.usernames[1], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [burned, clean];
    game.modifierStack.getEffective = (id, type, key) => (id === "b" && key === "burned" ? 1 : 0);

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, condition: "burned" });
    expect(targets.map((t) => t.id)).toEqual(["b"]);
  });

  test("applies trait filter", () => {
    const source = unit("s", game.usernames[0]);
    const taunt = unit("t", game.usernames[1], "scout");
    const plain = unit("p", game.usernames[1], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [taunt, plain];
    game.modifierStack.has = (id, type, key) => id === "t" && type === "trait" && key === "taunt";

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, trait: "taunt" });
    expect(targets.map((t) => t.id)).toEqual(["t"]);
  });

  test("applies rank filter", () => {
    const source = unit("s", game.usernames[0]);
    const ranker = unit("r", game.usernames[1], "scout", { card: { rank: "ranker" } });
    const regular = unit("g", game.usernames[1], "scout", { card: { rank: "regular" } });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [ranker, regular];

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, rank: "ranker" });
    expect(targets.map((t) => t.id)).toEqual(["r"]);
  });

  test("applies position filter", () => {
    const source = unit("s", game.usernames[0]);
    const front = unit("f", game.usernames[1], "fisherman");
    const back = unit("b", game.usernames[1], "spear-bearer");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [];
    game.playerStates[game.usernames[1]].field.backline = [front, back];

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, position: "spear-bearer" });
    expect(targets.map((t) => t.id)).toEqual(["b"]);
  });

  test("count limits the number of returned targets", () => {
    const source = unit("s", game.usernames[0]);
    const e1 = unit("e1", game.usernames[1], "scout");
    const e2 = unit("e2", game.usernames[1], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [e1, e2];

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, count: 1 });
    expect(targets.map((t) => t.id)).toEqual(["e1"]);
  });

  test("sharpshooter bypasses frontline blocking", () => {
    const source = unit("s", game.usernames[0]);
    const enemyFront = unit("ef", game.usernames[1], "fisherman");
    const enemyBack = unit("eb", game.usernames[1], "spear-bearer");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [enemyFront];
    game.playerStates[game.usernames[1]].field.backline = [enemyBack];
    game.modifierStack.has = (id, type, key) => id === "s" && type === "trait" && key === "sharpshooter";

    const targets = TargetResolver.resolveTargets(game, { target: "enemy", sourceUnit: source, count: 10 });
    expect(targets.map((t) => t.id)).toEqual(["ef", "eb"]);
  });

  test("ghost units do not block backline access", () => {
    const source = unit("s", game.usernames[0]);
    const ghostFront = unit("gf", game.usernames[1], "fisherman");
    const enemyBack = unit("eb", game.usernames[1], "spear-bearer");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [ghostFront];
    game.playerStates[game.usernames[1]].field.backline = [enemyBack];
    game.modifierStack.has = (id, type, key) => id === "gf" && type === "condition" && key === "ghost";

    const targets = TargetResolver.resolveTargets(game, { target: "enemy", sourceUnit: source, count: 10 });
    expect(targets.map((t) => t.id)).toEqual(["gf", "eb"]);
  });
});

describe("TargetResolver.normalizeStructuredTarget", () => {
  test("maps side + scope to canonical string targets", () => {
    expect(TargetResolver.normalizeStructuredTarget({ side: "self" }).target).toBe("self");
    expect(TargetResolver.normalizeStructuredTarget({ side: "bearer" }).target).toBe("bearer");
    expect(TargetResolver.normalizeStructuredTarget({ side: "ally" }).target).toBe("ally");
    expect(TargetResolver.normalizeStructuredTarget({ side: "ally", scope: "all" }).target).toBe("all_allies");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy" }).target).toBe("enemy");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", scope: "single" }).target).toBe("enemy");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", scope: "all" }).target).toBe("all_enemies");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", scope: "frontline" }).target).toBe("enemy_frontline");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", scope: "backline" }).target).toBe("enemy_backline");
    expect(TargetResolver.normalizeStructuredTarget({ side: "any" }).target).toBe("unit");
  });

  test("carries filter fields through unchanged", () => {
    const result = TargetResolver.normalizeStructuredTarget({
      side: "enemy", count: 2, condition: "rooted", trait: "taunt",
      rank: ["regular", "ranker"], name: "Conduit", affiliation: "team-chang",
    });
    expect(result.target).toBe("enemy");
    expect(result.count).toBe(2);
    expect(result.condition).toBe("rooted");
    expect(result.trait).toBe("taunt");
    expect(result.rank).toEqual(["regular", "ranker"]);
    expect(result.name).toBe("Conduit");
    expect(result.affiliation).toBe("team-chang");
  });

  test("throws on non-object, unknown side, and random/cost selection", () => {
    expect(() => TargetResolver.normalizeStructuredTarget(null)).toThrow("must be an object");
    expect(() => TargetResolver.normalizeStructuredTarget({ side: "bogus" })).toThrow("unknown structured target side");
    expect(() => TargetResolver.normalizeStructuredTarget({ side: "enemy", random: true })).toThrow("not supported yet");
    expect(() => TargetResolver.normalizeStructuredTarget({ side: "enemy", cost: 2 })).toThrow("not supported yet");
  });
});

describe("TargetResolver structured filters", () => {
  let game;

  beforeEach(() => {
    game = createTestGame();
    game.modifierStack.has = () => false;
  });

  function unit(id, owner, position = "scout", card = {}) {
    return { id, owner, isAlive: () => true, placedPositionCode: position, card };
  }

  test("affiliation filter supports single value and array (OR)", () => {
    const source = unit("s", game.usernames[0], "scout", { name: "Source", affiliations: {}, attributes: [] });
    const chang = unit("c", game.usernames[1], "scout", { name: "Chang", affiliations: { "team-chang": {} }, attributes: [] });
    const fug = unit("f", game.usernames[1], "scout", { name: "Fug", affiliations: { "fug": {} }, attributes: [] });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [chang, fug];

    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, affiliation: "team-chang", count: 10 }).map((t) => t.id)).toEqual(["c"]);
    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, affiliation: ["team-chang", "fug"], count: 10 }).map((t) => t.id)).toEqual(["c", "f"]);
  });

  test("attribute filter", () => {
    const source = unit("s", game.usernames[0], "scout", { name: "Source", affiliations: {}, attributes: [] });
    const hway = unit("h", game.usernames[1], "scout", { name: "Yihwa", affiliations: {}, attributes: ["hwayeomsa"] });
    const other = unit("o", game.usernames[1], "scout", { name: "Other", affiliations: {}, attributes: [] });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [hway, other];

    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, attribute: "hwayeomsa", count: 10 }).map((t) => t.id)).toEqual(["h"]);
  });

  test("name filter matches case-insensitively and exactly", () => {
    const source = unit("s", game.usernames[0], "scout", { name: "Source", affiliations: {}, attributes: [] });
    const conduit = unit("cd", game.usernames[1], "scout", { name: "Conduit", affiliations: {}, attributes: [] });
    const other = unit("o", game.usernames[1], "scout", { name: "Rachel", affiliations: {}, attributes: [] });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [conduit, other];

    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, name: "conduit", count: 10 }).map((t) => t.id)).toEqual(["cd"]);
  });

  test("rank and position filters accept arrays (OR)", () => {
    const source = unit("s", game.usernames[0], "scout", { name: "Source", rank: "regular", affiliations: {}, attributes: [] });
    const regular = unit("r", game.usernames[1], "fisherman", { name: "R", rank: "regular", affiliations: {}, attributes: [] });
    const ranker = unit("k", game.usernames[1], "spear-bearer", { name: "K", rank: "ranker", affiliations: {}, attributes: [] });
    const high = unit("h", game.usernames[1], "scout", { name: "H", rank: "high ranker", affiliations: {}, attributes: [] });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [];
    game.playerStates[game.usernames[1]].field.backline = [regular, ranker, high];

    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, rank: ["regular", "ranker"], count: 10 }).map((t) => t.id)).toEqual(["r", "k"]);
    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, position: ["fisherman", "scout"], count: 10 }).map((t) => t.id)).toEqual(["r", "h"]);
  });
});
