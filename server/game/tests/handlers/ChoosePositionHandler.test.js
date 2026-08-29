import { setupGameWithHands, deployUnit, getCardIdByName } from "../utils.js";
import ChoosePositionHandler from "../../handlers/ChoosePositionHandler.js";
import { resolveEffect } from "../../EffectResolver.js";
import Card from "../../Card.js";
import { jest } from "@jest/globals";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("ChoosePositionHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new ChoosePositionHandler();
  });

  test("requires a source unit", () => {
    expect(() => handler.validate({})).toThrow("sourceUnit");
  });

  test("the deploy trigger defers the landmark's choice through the handler", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"] });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");

    expect(game.pendingDecision.type).toBe("position_selection");
    expect(game.pendingDecision.owner).toBe("Alice");
    expect(game.pendingDecision.unitId).toBe(station.id);
    expect(game.pendingDecision.minChoices).toBe(1);
    expect(game.pendingDecision.maxChoices).toBe(1);
    expect(game.pendingDecision.candidates.map((c) => c.id)).toEqual([
      "fisherman",
      "light-bearer",
      "scout",
      "spear-bearer",
      "wave-controller",
    ]);
  });

  test("resolving the choice stores the code and activates the chosen rules", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"] });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });

    expect(station.chosenPositionCode).toBe("scout");
    expect(game._globalRuleRegistry.getActiveRules(game, "prevent_evolve")).toHaveLength(1);
  });

  test("no-op when the unit already chose", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"] });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });
    expect(game.pendingDecision).toBeNull();

    const result = handler.execute({ sourceUnit: station }, context(game), game);

    expect(result).toEqual({ chosen: false, reason: "already_chosen" });
    expect(game.pendingDecision).toBeNull();
  });

  test("leaves the unit's own pending decision in charge instead of creating duplicates", () => {
    const game = setupGameWithHands({ Alice: ["Test Name Hunt Station"] });
    const station = deployUnit(game, "Alice", "Test Name Hunt Station", "backline");
    const decisionId = game.pendingDecision.decisionId;

    const result = handler.execute({ sourceUnit: station }, context(game), game);

    expect(result).toEqual({ chosen: false, reason: "decision_pending" });
    expect(game.pendingDecision.decisionId).toBe(decisionId);
  });

  test("a landmark position choice resolver is a no-op once the landmark left play", () => {
    const game = setupGameWithHands({});
    const decisions = [];
    game.createPendingDecision = (opts) => { decisions.push(opts); };
    const landmarkCardId = getCardIdByName("Test Name Hunt Station");
    const unit = {
      id: "Unit#stale-landmark",
      owner: "Alice",
      chosenPositionCode: null,
      isAlive: () => true,
      card: new Card(landmarkCardId, game.cards[landmarkCardId], "Alice", game.eventBus),
    };
    const registry = { registerUnit: jest.fn(), reconcile: jest.fn() };
    game._globalRuleRegistry = registry;
    game._findUnit = () => null; // the landmark is off the field

    const result = handler.execute({ sourceUnit: unit }, context(game), game);
    expect(result).toEqual({ pending: true });
    expect(decisions).toHaveLength(1);
    decisions[0].resolve(["scout"]);

    // The stale resolution must not store a choice or re-register rules.
    expect(unit.chosenPositionCode).toBeNull();
    expect(registry.registerUnit).not.toHaveBeenCalled();
    expect(registry.reconcile).not.toHaveBeenCalled();
  });

  test("rejects a selection outside the candidates", () => {
    const game = setupGameWithHands({});
    const decisions = [];
    game.createPendingDecision = (opts) => { decisions.push(opts); };
    const unit = {
      id: "Unit#bad-choice",
      owner: "Alice",
      chosenPositionCode: null,
      isAlive: () => true,
      card: { name: "Test Name Hunt Station", kind: "landmark" },
    };
    game._findUnit = (id) => (id === unit.id ? unit : null);

    handler.execute({ sourceUnit: unit }, context(game), game);

    expect(() => decisions[0].resolve(["not-a-position"])).toThrow("Invalid selected position");
  });

  test("resolves through EffectResolver from a non-trigger path", () => {
    const game = setupGameWithHands({});
    const landmarkCardId = getCardIdByName("Test Name Hunt Station");
    const unit = {
      id: "Unit#raw-choice",
      owner: "Alice",
      chosenPositionCode: null,
      isAlive: () => true,
      card: new Card(landmarkCardId, game.cards[landmarkCardId], "Alice", game.eventBus),
    };
    game._findUnit = (id) => (id === unit.id ? unit : null);

    const result = resolveEffect(
      { type: "choose_position", raw: "deploy: choose a position" },
      context(game),
      game,
      { owner: "Alice", sourceId: "System", sourceUnit: unit, sourceOwner: "Alice" }
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.type).toBe("position_selection");
    expect(game.pendingDecision.unitId).toBe(unit.id);

    game.resolveDecision({ decisionId: game.pendingDecision.decisionId, choices: ["scout"], username: "Alice" });
    expect(unit.chosenPositionCode).toBe("scout");
  });
});
