import TargetResolver from "../../TargetResolver.js";
import { toCardTargetView } from "../../utils/cardData.js";
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

  test("the affiliation filter matches a unit holding only a granted affiliation", () => {
    const granted = { id: "granted1", owner: "Alice", isAlive: () => true, placedPositionCode: "scout", card: { rank: "regular", affiliations: {} } };
    const native = { id: "native1", owner: "Alice", isAlive: () => true, placedPositionCode: "scout", card: { rank: "regular", affiliations: { fug: {} } } };
    game.playerStates.Alice.field.frontline = [granted, native];

    game.modifierStack.apply({
      sourceId: "Passive#1",
      sourceType: "passive",
      targetId: "granted1",
      type: "affiliation",
      key: "fug",
      value: 1,
      operation: "add",
    });

    const targets = TargetResolver.resolveTargets(game, {
      target: "all_allies",
      sourceUnit: granted,
      affiliation: "fug",
      count: 10,
    });
    expect(targets.map((u) => u.id)).toEqual(["granted1", "native1"]);
  });

  test("resolveTargetSelection locks Taunt units and leaves free slots for a multi-target choice", () => {
    const source = { id: "source", owner: "Alice", isAlive: () => true, card: { rank: "regular" } };
    const taunter = { id: "taunter", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const other1 = { id: "other1", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const other2 = { id: "other2", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => id === "taunter" && type === "trait" && key === "taunt";

    const plan = TargetResolver.resolveTargetSelection(game, [taunter, other1, other2], { count: 2, sourceUnit: source });
    expect(plan.auto).toBe(false);
    expect(plan.lockedIds).toEqual(["taunter"]);
    expect(plan.freeCandidates.map((u) => u.id)).toEqual(["other1", "other2"]);
    expect(plan.freeCount).toBe(1);
  });

  test("resolveTargetSelection auto-selects all Taunt units when they equal the count", () => {
    const source = { id: "source", owner: "Alice", isAlive: () => true, card: { rank: "regular" } };
    const taunter1 = { id: "t1", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const taunter2 = { id: "t2", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const other = { id: "other", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => (id === "t1" || id === "t2") && type === "trait" && key === "taunt";

    const plan = TargetResolver.resolveTargetSelection(game, [taunter1, taunter2, other], { count: 2, sourceUnit: source });
    expect(plan.auto).toBe(true);
    expect(plan.ids).toEqual(["t1", "t2"]);
  });

  test("resolveTargetSelection defers the choice among Taunt units when they outnumber the count", () => {
    const source = { id: "source", owner: "Alice", isAlive: () => true, card: { rank: "regular" } };
    const taunter1 = { id: "t1", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const taunter2 = { id: "t2", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const other = { id: "other", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => (id === "t1" || id === "t2") && type === "trait" && key === "taunt";

    const plan = TargetResolver.resolveTargetSelection(game, [taunter1, taunter2, other], { count: 1, sourceUnit: source });
    expect(plan.auto).toBe(false);
    expect(plan.lockedIds).toEqual([]);
    expect(plan.freeCandidates.map((u) => u.id)).toEqual(["t1", "t2"]);
    expect(plan.freeCount).toBe(1);
  });

  test("resolveTargetSelection auto-selects every candidate when no genuine choice remains", () => {
    const source = { id: "source", owner: "Alice", isAlive: () => true, card: { rank: "regular" } };
    const e1 = { id: "e1", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const e2 = { id: "e2", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = () => false;

    // candidates == count
    expect(TargetResolver.resolveTargetSelection(game, [e1, e2], { count: 2, sourceUnit: source }))
      .toEqual({ auto: true, ids: ["e1", "e2"] });
    // candidates < count
    expect(TargetResolver.resolveTargetSelection(game, [e1, e2], { count: 3, sourceUnit: source }))
      .toEqual({ auto: true, ids: ["e1", "e2"] });
  });

  test("resolveTargetSelection with random auto-selects Taunt plus random free slots", () => {
    const source = { id: "source", owner: "Alice", isAlive: () => true, card: { rank: "regular" } };
    const taunter = { id: "taunter", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const free1 = { id: "free1", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const free2 = { id: "free2", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => id === "taunter" && type === "trait" && key === "taunt";

    const plan = TargetResolver.resolveTargetSelection(game, [taunter, free1, free2], { count: 2, sourceUnit: source, random: true });
    expect(plan.auto).toBe(true);
    expect(plan.ids).toHaveLength(2);
    expect(plan.ids).toContain("taunter");
    expect(plan.ids.filter((id) => id !== "taunter")).toHaveLength(1);
  });

  test("resolveTargetSelection ignores Taunt for skills without a source unit", () => {
    const taunter = { id: "taunter", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    const other = { id: "other", owner: "Bob", isAlive: () => true, card: { rank: "regular" } };
    game.modifierStack.has = (id, type, key) => id === "taunter" && type === "trait" && key === "taunt";

    const plan = TargetResolver.resolveTargetSelection(game, [taunter, other], { count: 1, sourceUnit: null });
    expect(plan.auto).toBe(false);
    expect(plan.lockedIds).toEqual([]);
    expect(plan.freeCandidates.map((u) => u.id)).toEqual(["taunter", "other"]);
    expect(plan.freeCount).toBe(1);
  });
});

describe("TargetResolver.resolveCardTargets", () => {
  const cardView = ({ id, name, series = null, type = "unit", cost = 0, rank = null, positions = [], affiliations = [], attributes = [] }) =>
    toCardTargetView({ id, cardId: id, name, series, type, cost, rank, positions, affiliations, attributes });

  test("returns empty for empty/non-array input and null descriptor", () => {
    expect(TargetResolver.resolveCardTargets([], { name: "anything" })).toEqual([]);
    expect(TargetResolver.resolveCardTargets(null, { name: "anything" })).toEqual([]);
    expect(TargetResolver.resolveCardTargets([cardView({ id: "c", name: "X" })], null)).toEqual([]);
  });

  test("resolves by exact series code (case-insensitive)", () => {
    const candidates = [
      cardView({ id: "card#1", name: "Incinerate I", series: "incinerate", type: "skill" }),
      cardView({ id: "card#2", name: "Incinerate II", series: "incinerate", type: "skill" }),
      cardView({ id: "card#3", name: "Fire Core", type: "skill" }),
    ];
    expect(TargetResolver.resolveCardTargets(candidates, { series: "incinerate" }).map((c) => c.id)).toEqual(["card#1", "card#2"]);
    expect(TargetResolver.resolveCardTargets(candidates, { series: "INCINERATE" }).map((c) => c.id)).toEqual(["card#1", "card#2"]);
    expect(TargetResolver.resolveCardTargets(candidates, { series: "incin" })).toEqual([]);
  });

  test("resolves by exact card name (case-insensitive)", () => {
    const candidates = [cardView({ id: "card#1", name: "Fiery Elephant", cost: 2 })];
    expect(TargetResolver.resolveCardTargets(candidates, { name: "Fiery Elephant" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { name: "fiery elephant" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { name: "Nonexistent" })).toEqual([]);
  });

  test("resolves exact, cheapest, and most-expensive cost selectors", () => {
    const candidates = [cardView({ id: "card#1", name: "A", cost: 1 }), cardView({ id: "card#2", name: "B", cost: 5 })];
    expect(TargetResolver.resolveCardTargets(candidates, { cost: 5 }).map((c) => c.id)).toEqual(["card#2"]);
    expect(TargetResolver.resolveCardTargets(candidates, { cost: "cheapest" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { cost: "most expensive" }).map((c) => c.id)).toEqual(["card#2"]);
  });

  test("resolves attribute, type, rank, position, and affiliation filters", () => {
    const hwayeomsa = cardView({ id: "card#1", name: "Yeon Yihwa", cost: 2, rank: "ranker", positions: ["wave-controller"], affiliations: ["fug"], attributes: ["hwayeomsa"] });
    const other = cardView({ id: "card#2", name: "Monkeyman", type: "skill", cost: 1, rank: "regular" });
    const candidates = [other, hwayeomsa];

    expect(TargetResolver.resolveCardTargets(candidates, { attribute: "hwayeomsa" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { type: "unit" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { rank: "ranker" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { position: "wave-controller" }).map((c) => c.id)).toEqual(["card#1"]);
    expect(TargetResolver.resolveCardTargets(candidates, { affiliation: "fug" }).map((c) => c.id)).toEqual(["card#1"]);
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

  test("'ally' includes the source unit", () => {
    const source = unit("s", game.usernames[0]);
    const allyFront = unit("af", game.usernames[0], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source, allyFront];

    const targets = TargetResolver.resolveTargets(game, { target: "ally", sourceUnit: source, count: 10 });
    expect(targets.map((t) => t.id)).toEqual(["s", "af"]);
  });

  test("'ally' with excludeSelf excludes only the source unit", () => {
    const source = unit("s", game.usernames[0]);
    const allyFront = unit("af", game.usernames[0], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source, allyFront];

    const targets = TargetResolver.resolveTargets(game, { target: "ally", sourceUnit: source, excludeSelf: true });
    expect(targets.map((t) => t.id)).toEqual(["af"]);
  });

  test("'ally' line scope filters by field line", () => {
    const source = unit("s", game.usernames[0], "scout", { line: "frontline" });
    const allyFront = unit("af", game.usernames[0], "scout", { line: "frontline" });
    const allyBack = unit("ab", game.usernames[0], "light-bearer", { line: "backline" });
    game.playerStates[game.usernames[0]].field.frontline = [source, allyFront];
    game.playerStates[game.usernames[0]].field.backline = [allyBack];

    expect(TargetResolver.resolveTargets(game, { target: "ally", sourceUnit: source, line: "frontline", count: 10 }).map((t) => t.id)).toEqual(["s", "af"]);
    expect(TargetResolver.resolveTargets(game, { target: "ally", sourceUnit: source, line: "backline", count: 10 }).map((t) => t.id)).toEqual(["ab"]);
    expect(TargetResolver.resolveTargets(game, { target: "ally", sourceUnit: source, line: "backline", excludeSelf: true, count: 10 }).map((t) => t.id)).toEqual(["ab"]);
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

  test("applies has_passive filter", () => {
    const source = unit("s", game.usernames[0]);
    const withPassive = unit("wp", game.usernames[1], "scout", { passiveAbilities: [{}] });
    const withoutPassive = unit("np", game.usernames[1], "scout");
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [withPassive, withoutPassive];

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, hasPassive: true });
    expect(targets.map((t) => t.id)).toEqual(["wp"]);
  });

  test("applies can_switch filter (only units with a legal other position pass)", () => {
    const source = unit("s", game.usernames[0]);
    const canSwitch = unit("sw", game.usernames[1], "fisherman", { positions: { fisherman: {}, "spear-bearer": {} } });
    const cannotSwitch = unit("ns", game.usernames[1], "fisherman", { positions: { fisherman: {} } });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [canSwitch, cannotSwitch];

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, canSwitch: true });
    expect(targets.map((t) => t.id)).toEqual(["sw"]);
  });

  test("can_switch filter excludes a unit whose destination line is full", () => {
    const source = unit("s", game.usernames[0]);
    const fullBackline = unit("sw", game.usernames[1], "fisherman", { positions: { fisherman: {}, "spear-bearer": {} } });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [fullBackline];
    // Fill Bob's backline to capacity (5), so spear-bearer has no room.
    game.playerStates[game.usernames[1]].field.backline = [
      unit("b1", game.usernames[1], "spear-bearer"),
      unit("b2", game.usernames[1], "spear-bearer"),
      unit("b3", game.usernames[1], "spear-bearer"),
      unit("b4", game.usernames[1], "spear-bearer"),
      unit("b5", game.usernames[1], "spear-bearer"),
    ];

    const targets = TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, canSwitch: true });
    expect(targets).toEqual([]);
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
    expect(TargetResolver.normalizeStructuredTarget({ side: "ally", scope: "frontline" })).toEqual({ target: "ally", line: "frontline" });
    expect(TargetResolver.normalizeStructuredTarget({ side: "ally", scope: "backline" })).toEqual({ target: "ally", line: "backline" });
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
    expect(result.target).toBe("enemies");
    expect(result.count).toBe(2);
    expect(result.condition).toBe("rooted");
    expect(result.trait).toBe("taunt");
    expect(result.rank).toEqual(["regular", "ranker"]);
    expect(result.name).toBe("Conduit");
    expect(result.affiliation).toBe("team-chang");
  });

  test("maps multi-target enemy (count > 1) to the 'enemies' descriptor", () => {
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", count: 2 }).target).toBe("enemies");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", count: 3 }).target).toBe("enemies");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy" }).target).toBe("enemy");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", count: 1 }).target).toBe("enemy");
  });

  test("throws on non-object and unknown side; passes random/cost/choose/lowest_hp through", () => {
    expect(() => TargetResolver.normalizeStructuredTarget(null)).toThrow("must be an object");
    expect(() => TargetResolver.normalizeStructuredTarget({ side: "bogus" })).toThrow("unknown structured target side");
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", random: true })).toMatchObject({ target: "enemy", random: true });
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", cost: 2 }).cost).toBe(2);
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", choose: true }).choose).toBe(true);
    expect(TargetResolver.normalizeStructuredTarget({ side: "enemy", lowest_hp: true }).lowestHp).toBe(true);
    expect(TargetResolver.normalizeStructuredTarget({ side: "ally", exclude_self: true })).toMatchObject({ target: "ally", excludeSelf: true });
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

  test("shared_affiliation filter matches native and granted affiliations", () => {
    const source = unit("s", game.usernames[0], "scout", { name: "Source", affiliations: { "team-chang": {} }, attributes: [] });
    const sharesNative = unit("c", game.usernames[1], "scout", { name: "Chang", affiliations: { "team-chang": {} }, attributes: [] });
    const sharesGranted = unit("w", game.usernames[1], "scout", { name: "Wol", affiliations: {}, attributes: [] });
    const noShare = unit("f", game.usernames[1], "scout", { name: "Fug", affiliations: { "fug": {} }, attributes: [] });
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [sharesNative, sharesGranted, noShare];

    game.modifierStack.apply({ sourceId: "sys", sourceType: "system", targetId: "s", type: "affiliation", key: "wolhaiksong", value: 1 });
    game.modifierStack.apply({ sourceId: "sys", sourceType: "system", targetId: "w", type: "affiliation", key: "wolhaiksong", value: 1 });

    expect(TargetResolver.resolveTargets(game, { target: "all_enemies", sourceUnit: source, sharedAffiliation: true, count: 10 }).map((t) => t.id)).toEqual(["c", "w"]);
  });

  test("shared_affiliation filter throws without a source unit", () => {
    const c = unit("c", game.usernames[1], "scout", { name: "Chang", affiliations: { "team-chang": {} }, attributes: [] });
    game.playerStates[game.usernames[1]].field.frontline = [c];
    expect(() => TargetResolver.resolveTargets(game, { target: "all_enemies", sourceOwner: game.usernames[0], sharedAffiliation: true }))
      .toThrow("shared_affiliation filter requires sourceUnit");
  });

  test("kind and line filters match a unit's archetype and field line", () => {
    const source = unit("s", game.usernames[0], "scout", { name: "Source", kind: "standard", affiliations: {}, attributes: [] });
    const bull = { ...unit("b", game.usernames[1], null, { name: "Bull", kind: "shinheuh", affiliations: {}, attributes: [] }), line: "frontline" };
    const stone = { ...unit("st", game.usernames[1], null, { name: "Stone Doll", kind: "shinheuh", affiliations: {}, attributes: [] }), line: "frontline" };
    const landmark = { ...unit("lm", game.usernames[1], null, { name: "Landmark", kind: "landmark", affiliations: {}, attributes: [] }), line: "backline" };
    game.playerStates[game.usernames[0]].field.frontline = [source];
    game.playerStates[game.usernames[1]].field.frontline = [bull, stone];
    game.playerStates[game.usernames[1]].field.backline = [landmark];

    expect(TargetResolver.resolveTargets(game, { target: "unit", kind: "shinheuh", count: 10 }).map((t) => t.id)).toEqual(["b", "st"]);
    expect(TargetResolver.resolveTargets(game, { target: "unit", kind: "landmark", count: 10 }).map((t) => t.id)).toEqual(["lm"]);
    expect(TargetResolver.resolveTargets(game, { target: "unit", kind: "shinheuh", line: "frontline", count: 10 }).map((t) => t.id)).toEqual(["b", "st"]);
  });

  test("resolveExistenceUnits inherits kind filtering via applyFilters", () => {
    const bull = { ...unit("b", game.usernames[1], null, { name: "Bull", kind: "shinheuh", affiliations: {}, attributes: [] }), line: "frontline" };
    game.playerStates[game.usernames[1]].field.frontline = [bull];

    expect(TargetResolver.resolveExistenceUnits(game, { side: "enemy", kind: "shinheuh" }, game.usernames[0]).map((u) => u.id)).toEqual(["b"]);
    expect(TargetResolver.resolveExistenceUnits(game, { side: "enemy", kind: "landmark" }, game.usernames[0])).toEqual([]);
  });
});
