import GlobalRuleRegistry from "../../services/GlobalRuleRegistry.js";
import ModifierStack from "../../ModifierStack.js";
import * as IdFactory from "../../IdFactory.js";

function makeBus() {
  const handlers = new Map();
  return {
    on(eventName, handler) {
      if (!handlers.has(eventName)) handlers.set(eventName, []);
      handlers.get(eventName).push(handler);
      return () => {};
    },
    emit(eventName, payload) {
      for (const handler of handlers.get(eventName) || []) handler(payload);
    },
  };
}

function makeGame() {
  const bus = makeBus();
  return { modifierStack: new ModifierStack(bus, { now: () => 0 }), eventBus: bus };
}

function landmarkUnit(overrides = {}) {
  return {
    id: "Unit#9#1",
    card: {
      kind: "landmark",
      rules: [
        { type: "disable_passives", raw: "passives have no effect" },
        { type: "condition_stack_cap", cap: 2, raw: "conditions do not stack past 2" },
      ],
    },
    ...overrides,
  };
}

describe("GlobalRuleRegistry", () => {
  let registry;

  beforeEach(() => {
    IdFactory.resetAll();
    registry = new GlobalRuleRegistry();
  });

  test("registers a landmark's rules as source-tracked entries", () => {
    const game = makeGame();
    const unit = landmarkUnit();
    registry.registerUnit(unit, game);

    const mods = game.modifierStack.getModifiers(unit.id, "rule");
    expect(mods).toHaveLength(2);
    expect(mods.map((m) => m.key)).toEqual(["disable_passives", "condition_stack_cap"]);
    expect(mods.every((m) => m.sourceType === "landmark")).toBe(true);
    expect(mods.every((m) => m.sourceId === IdFactory.landmarkSource(unit.id))).toBe(true);
    expect(mods[0].meta.rule).toEqual({ type: "disable_passives", raw: "passives have no effect" });
  });

  test("skips non-landmark units and landmark cards without rules", () => {
    const game = makeGame();
    registry.registerUnit({ id: "Unit#1#1", card: { kind: "standard", rules: [] } }, game);
    registry.registerUnit({ id: "Unit#2#1", card: { kind: "landmark", rules: [] } }, game);
    expect(game.modifierStack.getModifiers("Unit#1#1", "rule")).toHaveLength(0);
    expect(game.modifierStack.getModifiers("Unit#2#1", "rule")).toHaveLength(0);
  });

  test("unregisterUnit revokes every rule the landmark registered", () => {
    const game = makeGame();
    const unit = landmarkUnit();
    registry.registerUnit(unit, game);
    expect(game.modifierStack.getModifiers(unit.id, "rule")).toHaveLength(2);

    registry.unregisterUnit(unit.id, game);
    expect(game.modifierStack.getModifiers(unit.id, "rule")).toHaveLength(0);
  });
});
