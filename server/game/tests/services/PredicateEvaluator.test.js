import GameState from "../../GameState.js";
import SeededRng from "../../utils/SeededRng.js";
import { createLegalDeck, getCardIdByName } from "../utils.js";
import PredicateEvaluator from "../../services/PredicateEvaluator.js";

const players = ["Alice", "Bob"];

function createGame(decks = {}) {
  return new GameState("TEST", players, {
    Alice: decks.Alice || createLegalDeck(),
    Bob: decks.Bob || createLegalDeck(),
  }, null, { rng: new SeededRng(1) });
}

function unit(id, owner, position = "fisherman", { name = id, rank = "regular", affiliations = {}, attributes = [], maxHp = 10 } = {}) {
  return {
    id,
    owner,
    placedPositionCode: position,
    currentHp: maxHp,
    card: { name, rank, affiliations, attributes, maxHp },
    equipmentAttachments: [],
    isAlive() { return this.currentHp > 0; },
  };
}

function push(game, owner, u) {
  game.playerStates[owner].field.frontline.push(u);
  return u;
}

describe("PredicateEvaluator", () => {
  describe("has_unit", () => {
    test("matches an allied unit by position", () => {
      const game = createGame();
      push(game, "Alice", unit("wc", "Alice", "wave-controller"));

      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", position: "wave-controller" } },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", position: "fisherman" } },
        game, { owner: "Alice" }
      )).toBe(false);
    });

    test("matches an enemy unit by attribute, ignoring offensive-targeting rules", () => {
      const game = createGame();
      push(game, "Bob", unit("blocker", "Bob", "fisherman"));
      const jeonsulsa = unit("khun", "Bob", "spear-bearer", { attributes: ["jeonsulsa"] });
      game.playerStates.Bob.field.backline.push(jeonsulsa);

      // A backline enemy behind a frontline blocker would be blocked by normal
      // targeting, but an existence check must still find it.
      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "enemy", attribute: "jeonsulsa" } },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "enemy", attribute: "jeonsulsa" }, negate: true },
        game, { owner: "Alice" }
      )).toBe(false);
    });

    test("matches by affiliation, name, and array-OR attribute", () => {
      const game = createGame();
      push(game, "Alice", unit("guide", "Alice", "scout", {
        name: "Hwa Ryun",
        affiliations: { "silver-dwarf": {} },
        attributes: ["red-witch"],
      }));

      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", affiliation: "silver-dwarf" } },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", name: "Hwa Ryun" } },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", attribute: ["red-witch", "silver-dwarf"] } },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", name: "Yeo Miseng" } },
        game, { owner: "Alice" }
      )).toBe(false);
    });
  });

  describe("alone_on_line", () => {
    test("true when the source unit is the only alive unit on its line", () => {
      const game = createGame();
      const u = push(game, "Alice", unit("urek", "Alice", "fisherman"));

      expect(PredicateEvaluator.evaluate(
        { type: "alone_on_line", line: "frontline" },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(true);
    });

    test("false with a second unit on the line, and false without a source unit", () => {
      const game = createGame();
      const u = push(game, "Alice", unit("urek", "Alice", "fisherman"));
      push(game, "Alice", unit("ally", "Alice", "scout"));

      expect(PredicateEvaluator.evaluate(
        { type: "alone_on_line", line: "frontline" },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(false);
      expect(PredicateEvaluator.evaluate(
        { type: "alone_on_line", line: "frontline" },
        game, { owner: "Alice" }
      )).toBe(false);
    });
  });

  describe("started_with_card", () => {
    test("reflects the per-player starting deck composition", () => {
      const game = createGame({
        Alice: createLegalDeck([getCardIdByName("Rachel")]),
        Bob: createLegalDeck([getCardIdByName("Baang")]),
      });

      expect(PredicateEvaluator.evaluate(
        { type: "started_with_card", cardName: "Rachel" },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "started_with_card", cardName: "Rachel" },
        game, { owner: "Bob" }
      )).toBe(false);
      expect(PredicateEvaluator.evaluate(
        { type: "started_with_card", cardName: "Baang" },
        game, { owner: "Bob" }
      )).toBe(true);
    });
  });

  describe("has_equipped / has_all_equipped", () => {
    test("detect equipment attachments by name", () => {
      const game = createGame();
      const u = push(game, "Alice", unit("bearer", "Alice"));

      u.equipmentAttachments = [{ name: "Purple Dementor" }];
      expect(PredicateEvaluator.evaluate(
        { type: "has_equipped", cardName: "Purple Dementor" },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_equipped", cardName: "Steel Tree" },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(false);

      const names = ["First Thorn Fragment", "Second Thorn Fragment", "Third Thorn Fragment", "Fourth Thorn Fragment"];
      u.equipmentAttachments = names.map((name) => ({ name }));
      expect(PredicateEvaluator.evaluate(
        { type: "has_all_equipped", cardNames: names },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(true);

      u.equipmentAttachments.pop();
      expect(PredicateEvaluator.evaluate(
        { type: "has_all_equipped", cardNames: names },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(false);
    });

    test("counts equipment attachments", () => {
      const game = createGame();
      const u = push(game, "Alice", unit("bearer", "Alice"));

      u.equipmentAttachments = [
        { name: "Dionysos: Arms" },
        { name: "Dionysos: Legs" },
        { name: "Dionysos: Wings" },
        { name: "First Thorn Fragment" },
        { name: "Second Thorn Fragment" },
      ];
      expect(PredicateEvaluator.evaluate(
        { type: "has_equipment_count", amount: 5 },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(true);

      u.equipmentAttachments.pop();
      expect(PredicateEvaluator.evaluate(
        { type: "has_equipment_count", amount: 5 },
        game, { owner: "Alice", sourceUnit: u }
      )).toBe(false);
    });
  });

  describe("has_condition", () => {
    test("detects units with a condition at or above a threshold", () => {
      const game = createGame();
      const u = push(game, "Bob", unit("burned", "Bob"));
      game.modifierStack.apply({
        sourceId: "System",
        sourceType: "system",
        targetId: u.id,
        type: "condition",
        key: "burned",
        value: 3,
      });

      expect(PredicateEvaluator.evaluate(
        { type: "has_condition", condition: "burned", conditionValue: 3, target: { side: "enemy" } },
        game, { owner: "Alice" }
      )).toBe(true);
      expect(PredicateEvaluator.evaluate(
        { type: "has_condition", condition: "burned", conditionValue: 4, target: { side: "enemy" } },
        game, { owner: "Alice" }
      )).toBe(false);
    });
  });

  describe("negate and validation", () => {
    test("negate inverts the result", () => {
      const game = createGame();
      push(game, "Alice", unit("wc", "Alice", "wave-controller"));

      expect(PredicateEvaluator.evaluate(
        { type: "has_unit", target: { side: "ally", position: "wave-controller" }, negate: true },
        game, { owner: "Alice" }
      )).toBe(false);
    });

    test("throws on an unknown predicate type", () => {
      const game = createGame();
      expect(() => PredicateEvaluator.evaluate({ type: "does_not_exist" }, game, { owner: "Alice" }))
        .toThrow("unknown predicate type");
    });

    test("throws when the predicate is missing or has no type", () => {
      const game = createGame();
      expect(() => PredicateEvaluator.evaluate(null, game, { owner: "Alice" }))
        .toThrow("must be an object with a `type`");
      expect(() => PredicateEvaluator.evaluate({}, game, { owner: "Alice" }))
        .toThrow("must be an object with a `type`");
    });

    test("throws when required fields are missing", () => {
      const game = createGame();
      expect(() => PredicateEvaluator.evaluate({ type: "has_unit" }, game, { owner: "Alice" }))
        .toThrow("has_unit requires `target`");
      expect(() => PredicateEvaluator.evaluate({ type: "alone_on_line" }, game, { owner: "Alice" }))
        .toThrow("alone_on_line requires `line`");
      expect(() => PredicateEvaluator.evaluate({ type: "started_with_card" }, game, { owner: "Alice" }))
        .toThrow("started_with_card requires `cardName`");
      expect(() => PredicateEvaluator.evaluate({ type: "has_equipped" }, game, { owner: "Alice" }))
        .toThrow("has_equipped requires `cardName`");
      expect(() => PredicateEvaluator.evaluate({ type: "has_all_equipped" }, game, { owner: "Alice" }))
        .toThrow("has_all_equipped requires a `cardNames` array");
      expect(() => PredicateEvaluator.evaluate({ type: "has_condition" }, game, { owner: "Alice" }))
        .toThrow("has_condition requires `condition`");
    });

    test("started_with_card without an owner resolves false", () => {
      const game = createGame();
      expect(PredicateEvaluator.evaluate({ type: "started_with_card", cardName: "Rachel" }, game, {})).toBe(false);
    });

    test("existence checks reject unsupported sides and missing owners", () => {
      const game = createGame();
      expect(() => PredicateEvaluator.evaluate({ type: "has_unit", target: { side: "self" } }, game, { owner: "Alice" }))
        .toThrow("does not support side");
      expect(() => PredicateEvaluator.evaluate({ type: "has_unit", target: { side: "ally" } }, game, {}))
        .toThrow("requires sourceOwner");
    });
  });
});
