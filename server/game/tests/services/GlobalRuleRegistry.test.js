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

    registry.unregisterUnit(unit, game);
    expect(game.modifierStack.getModifiers(unit.id, "rule")).toHaveLength(0);
  });

  test("unregisterUnit discards the landmark's chosen position", () => {
    const game = makeGame();
    const unit = landmarkUnit();
    unit.chosenPositionCode = "scout";
    registry.registerUnit(unit, game);
    registry.unregisterUnit(unit, game);
    expect(unit.chosenPositionCode).toBeNull();
  });

  test("a chosen rule defers alone while explicit rules register immediately", () => {
    const game = makeGame();
    const landmark = landmarkUnit({
      card: {
        kind: "landmark",
        rules: [
          { type: "prevent_evolve", position: "chosen", raw: "chosen units cannot evolve" },
          { type: "prevent_equip", position: "scout", raw: "scout units cannot be equipped" },
        ],
      },
    });
    const scout = { id: "Unit#scout", placedPositionCode: "scout", card: { attributes: [] } };
    game._findUnit = (id) => (id === landmark.id ? landmark : null);

    registry.registerUnit(landmark, game);
    // The explicit scout rule is active while the choice is still pending;
    // the unrelated chosen rule does not hold it up.
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(1);
    expect(registry.hasRule(scout, "prevent_equip", game)).toBe(true);
    expect(registry.hasRule(scout, "prevent_evolve", game)).toBe(false);

    landmark.chosenPositionCode = "scout";
    registry.registerUnit(landmark, game);
    // The chosen rule joins without duplicating the explicit one.
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(2);
    expect(registry.hasRule(scout, "prevent_equip", game)).toBe(true);
    expect(registry.hasRule(scout, "prevent_evolve", game)).toBe(true);
  });

  test("repeated registration never stacks rule entries", () => {
    const game = makeGame();
    const unit = landmarkUnit();
    registry.registerUnit(unit, game);
    registry.registerUnit(unit, game);
    registry.registerUnit(unit, game);
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(2);

    // The same holds across a chosen-position pick and further re-registration.
    const chosen = landmarkUnit({
      id: "Unit#9#2",
      card: {
        kind: "landmark",
        rules: [{ type: "prevent_evolve", position: "chosen", raw: "chosen units cannot evolve" }],
      },
    });
    game._findUnit = (id) => (id === chosen.id ? chosen : null);
    registry.registerUnit(chosen, game);
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(2); // deferred
    chosen.chosenPositionCode = "scout";
    registry.registerUnit(chosen, game);
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(3);
    registry.registerUnit(chosen, game);
    expect(game.modifierStack.getModifiersByType("rule")).toHaveLength(3);
  });

  test("getConditionCap returns the minimum cap among active rules", () => {
    const game = makeGame();
    const cap2 = landmarkUnit({
      id: "Unit#cap2",
      card: { kind: "landmark", rules: [{ type: "condition_stack_cap", cap: 2, raw: "cap 2" }] },
    });
    const cap5 = landmarkUnit({
      id: "Unit#cap5",
      card: { kind: "landmark", rules: [{ type: "condition_stack_cap", cap: 5, raw: "cap 5" }] },
    });
    const unit = { id: "Unit#target", placedPositionCode: "scout", card: { attributes: [] } };
    game._findUnit = (id) => (id === cap2.id ? cap2 : id === cap5.id ? cap5 : null);

    registry.registerUnit(cap2, game);
    expect(registry.getConditionCap(unit, "poisoned", game)).toBe(2);
    registry.registerUnit(cap5, game);
    expect(registry.getConditionCap(unit, "poisoned", game)).toBe(2);
    registry.unregisterUnit(cap2, game);
    expect(registry.getConditionCap(unit, "poisoned", game)).toBe(5);
  });

  test("active queries filter type and disabled rules", () => {
    const game = makeGame();
    const unit = landmarkUnit();
    registry.registerUnit(unit, game);
    const [disablePassives] = game.modifierStack.getModifiers(unit.id, "rule");
    disablePassives.disabledCount = 1;

    expect(registry.getActiveRules(game).map((rule) => rule.key)).toEqual(["condition_stack_cap"]);
    expect(registry.getActiveRules(game, "disable_passives")).toEqual([]);
    expect(registry.getActiveRules(game, "condition_stack_cap")).toHaveLength(1);
  });

  test("chosen-position rules activate only after a choice and ignore Irregulars", () => {
    const game = makeGame();
    const landmark = landmarkUnit({
      card: {
        kind: "landmark",
        rules: [{ type: "prevent_evolve", position: "chosen", raw: "chosen units cannot evolve" }],
      },
    });
    const regular = { id: "Unit#1", placedPositionCode: "scout", card: { attributes: [] } };
    const irregular = { id: "Unit#2", placedPositionCode: "scout", card: { attributes: ["irregular"] } };
    game._findUnit = (id) => id === landmark.id ? landmark : null;

    registry.registerUnit(landmark, game);
    expect(registry.getActiveRules(game)).toHaveLength(0);

    landmark.chosenPositionCode = "scout";
    registry.registerUnit(landmark, game);
    expect(registry.hasRule(regular, "prevent_evolve", game)).toBe(true);
    expect(registry.hasRule(irregular, "prevent_evolve", game)).toBe(false);
  });

  test("validates positions without relying on a GameState constructor", () => {
    const game = makeGame();
    expect(() => registry.registerUnit(landmarkUnit({
      card: { kind: "landmark", rules: [{ type: "prevent_equip", position: "not-a-position", raw: "bad" }] },
    }), game)).toThrow("Invalid landmark rule position");
  });

  test.each([
    [{ type: "disable_passives", raw: "   " }, "non-empty raw text"],
    [{ type: "grant_global_trait", trait: "not-a-trait", raw: "bad trait" }, "Invalid landmark trait"],
    [{ type: "grant_global_condition", condition: "not-a-condition", raw: "bad condition" }, "Invalid landmark condition"],
    [{ type: "prevent_equip", raw: "bad field", cap: 1 }, "cannot declare a cap"],
    [{ type: "condition_stack_cap", cap: 2, position: "scout", raw: "bad scope" }, "cannot declare a position"],
    [{ type: "prevent_evolve", raw: "bad field", unexpected: true }, "Unknown landmark rule field"],
  ])("rejects compiled rule contract violations", (rule, error) => {
    const game = makeGame();
    expect(() => registry.registerUnit(landmarkUnit({
      card: { kind: "landmark", rules: [rule] },
    }), game)).toThrow(error);
  });
});
