import RequirementValidator from "../../services/RequirementValidator.js";
import { setupGameWithCardsInHand } from "../utils.js";

// Requirements are compiled structured check objects (see the requirements
// grammar in docs/COMPILED_CARD_DSL.md). Tests author the compiled shape.

const deployedAs = (position, raw = `deployed as ${position}`) => ({ type: "deployed_as", position, raw });
const targetSide = (side, raw = `target is ${side === "ally" ? "an ally" : "an enemy"}`) => ({ type: "target_side", side, raw });
const unitOnBoard = (name) => ({ type: "unit_on_board", name, raw: `${name} is in your board` });
const firstCard = () => ({ type: "first_card_this_round", raw: "I'm the first card you play this round" });
const hasAlly = (fields, raw) => ({ type: "has_ally", ...fields, raw });
const bearerHas = (fields, raw) => ({ type: "bearer_has", ...fields, raw });

describe("RequirementValidator", () => {
  let game;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Test Hwayeomsa", "Test Light Bearer Only", "Test Light Bearer Only", "Test Light Bearer Only"]);
  });

  // ── deployed_as ───────────────────────────────────────────────────────────

  test("deployed_as — passes when the position code matches", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    const unit = game.playerStates.Alice.field.frontline[0];
    expect(() =>
      RequirementValidator.validate([deployedAs("fisherman")], { gameState: game, username: "Alice", sourceUnit: unit })
    ).not.toThrow();
  });

  test("deployed_as — compares position codes, so a multi-word position matches", () => {
    // Regression: the string-based validator compared the authored display
    // text ("wave controller") against the placed position code
    // ("wave-controller") and failed even when the unit stood correctly.
    const unit = { id: "u1", owner: "Alice", placedPositionCode: "wave-controller" };
    expect(() =>
      RequirementValidator.validate([deployedAs("wave-controller")], { gameState: game, username: "Alice", sourceUnit: unit })
    ).not.toThrow();
  });

  test("deployed_as — throws when wrong", () => {
    const unit = { id: "u1", owner: "Alice", placedPositionCode: "scout" };
    expect(() =>
      RequirementValidator.validate([deployedAs("fisherman")], { gameState: game, username: "Alice", sourceUnit: unit })
    ).toThrow(/deployed as fisherman/i);
  });

  // ── target_side ───────────────────────────────────────────────────────────

  test("target_side ally — passes when correct", () => {
    const ally = { id: "u2", owner: "Alice", card: {} };
    const source = { id: "u1", owner: "Alice", card: {} };
    expect(() =>
      RequirementValidator.validate([targetSide("ally")], { gameState: game, username: "Alice", sourceUnit: source, targetUnit: ally })
    ).not.toThrow();
  });

  test("target_side ally — throws when target is enemy", () => {
    const enemy = { id: "u2", owner: "Bob", card: {} };
    const source = { id: "u1", owner: "Alice", card: {} };
    expect(() =>
      RequirementValidator.validate([targetSide("ally")], { gameState: game, username: "Alice", sourceUnit: source, targetUnit: enemy })
    ).toThrow(/must be an ally/i);
  });

  test("target_side ally — passes without an explicit target when an allied unit is deployed", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate([targetSide("ally")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("target_side ally — throws without an explicit target when the board is empty", () => {
    expect(() =>
      RequirementValidator.validate([targetSide("ally")], { gameState: game, username: "Alice" })
    ).toThrow(/need an allied unit on your board/i);
  });

  // ── bearer_has ────────────────────────────────────────────────────────────

  test("bearer_has — passes when the bearer itself has the affiliation", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Light Bearer Only");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: khunIdx, placedPositionCode: "light-bearer" } });
    const bearer = game.playerStates.Alice.field.backline[0];

    expect(() =>
      RequirementValidator.validate([bearerHas({ affiliation: "khun-family" }, "khun family member")], { gameState: game, username: "Alice", sourceUnit: bearer })
    ).not.toThrow();
  });

  test("bearer_has — throws when the bearer lacks it, even if another allied unit has it", () => {
    // Regression: the string-based validator checked the whole board, so a
    // non-khun bearer could pass as long as any khun-family unit stood
    // elsewhere. The bearer check is strict.
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    // The bearer (Test Hwayeomsa) has no khun-family affiliation.
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    const bearer = game.playerStates.Alice.field.frontline[0];
    // A different allied unit carries khun-family.
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Light Bearer Only");
    game.currentTurn = "Alice";
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: khunIdx, placedPositionCode: "light-bearer" } });

    expect(() =>
      RequirementValidator.validate([bearerHas({ affiliation: "khun-family" }, "khun family member")], { gameState: game, username: "Alice", sourceUnit: bearer })
    ).toThrow(/khun family member/i);
  });

  test("bearer_has — passes when the affiliation is modifier-granted on the bearer", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    const bearer = game.playerStates.Alice.field.frontline[0];

    game.modifierStack.apply({
      sourceId: "test-source",
      sourceType: "system",
      targetId: bearer.id,
      type: "affiliation",
      key: "khun-family",
      operation: "add",
    });

    expect(() =>
      RequirementValidator.validate([bearerHas({ affiliation: "khun-family" }, "khun family member")], { gameState: game, username: "Alice", sourceUnit: bearer })
    ).not.toThrow();
  });

  test("bearer_has — throws without a source unit (skills have no bearer)", () => {
    expect(() =>
      RequirementValidator.validate([bearerHas({ affiliation: "khun-family" }, "khun family member")], { gameState: game, username: "Alice" })
    ).toThrow(/khun family member/i);
  });

  // ── unit_on_board ─────────────────────────────────────────────────────────

  test("unit_on_board — passes when present", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate([unitOnBoard("Test Hwayeomsa")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("unit_on_board — throws when absent", () => {
    expect(() =>
      RequirementValidator.validate([unitOnBoard("Yeon Woon")], { gameState: game, username: "Alice" })
    ).toThrow(/Yeon Woon.*board/i);
  });

  // ── has_ally ──────────────────────────────────────────────────────────────

  test("has_ally affiliation — passes when present", () => {
    game.round = 3;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 3, recharged: 0 };
    // Deploy Test Light Bearer Only (has khun-family affiliation)
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Light Bearer Only");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: khunIdx, placedPositionCode: "light-bearer" } });

    expect(() =>
      RequirementValidator.validate([hasAlly({ affiliation: "khun-family" }, "khun family member")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("has_ally affiliation — throws when absent", () => {
    expect(() =>
      RequirementValidator.validate([hasAlly({ affiliation: "arie-family" }, "arie family member")], { gameState: game, username: "Alice" })
    ).toThrow(/arie family/i);
  });

  test("has_ally affiliation + attribute — passes when the attribute branch matches", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate([hasAlly({ affiliation: "yeon-family", attribute: "hwayeomsa" }, "you have an ally yeon family member or Hwayeomsa")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("has_ally affiliation + attribute — throws when neither branch matches", () => {
    expect(() =>
      RequirementValidator.validate([hasAlly({ affiliation: "hendo-lok-family", attribute: "anima" }, "you have an ally hendo lok family member or anima")], { gameState: game, username: "Alice" })
    ).toThrow(/hendo lok/i);
  });

  test("has_ally attribute — passes when present", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate([hasAlly({ attribute: "hwayeomsa" }, "have an ally Hwayeomsa")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("has_ally attribute — throws when absent", () => {
    expect(() =>
      RequirementValidator.validate([hasAlly({ attribute: "irregular" }, "have an ally Irregular")], { gameState: game, username: "Alice" })
    ).toThrow(/irregular/i);
  });

  // ── Modifier-granted attribute/affiliation regression ──────────────────
  // Regression for a ReferenceError: hasAttribute() previously referenced an
  // out-of-scope `gameState` instead of an explicit parameter, so any
  // attribute check that fell through to the ModifierStack branch (i.e. the
  // unit's compiled card data did NOT already have the attribute) crashed
  // instead of validating. This only surfaces when checking a unit that
  // gained the attribute at runtime (e.g. via a granted keyword modifier)
  // rather than one baked into its compiled card.

  test("has_ally attribute — passes when the attribute is modifier-granted, not on the card", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    // Test Light Bearer Only has no "hwayeomsa" attribute on her compiled card.
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Light Bearer Only");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: khunIdx, placedPositionCode: "light-bearer" } });
    const unit = game.playerStates.Alice.field.backline[0];
    expect(unit.card.attributes || []).not.toContain("hwayeomsa");

    game.modifierStack.apply({
      sourceId: "test-source",
      sourceType: "system",
      targetId: unit.id,
      type: "attribute",
      key: "hwayeomsa",
      operation: "add",
    });

    expect(() =>
      RequirementValidator.validate([hasAlly({ attribute: "hwayeomsa" }, "have an ally Hwayeomsa")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("has_ally affiliation + attribute — passes when the attribute branch is satisfied only via ModifierStack", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Test Light Bearer Only");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: khunIdx, placedPositionCode: "light-bearer" } });
    const unit = game.playerStates.Alice.field.backline[0];

    game.modifierStack.apply({
      sourceId: "test-source",
      sourceType: "system",
      targetId: unit.id,
      type: "attribute",
      key: "anima",
      operation: "add",
    });

    // "yeon family" (absent) or "anima" (modifier-granted) — must pass via the
    // ModifierStack branch of hasAttribute, not the compiled-card branch.
    expect(() =>
      RequirementValidator.validate([hasAlly({ affiliation: "yeon-family", attribute: "anima" }, "you have an ally yeon family member or anima")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("has_ally affiliation — passes when only ModifierStack-granted", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });
    const unit = game.playerStates.Alice.field.frontline[0];

    game.modifierStack.apply({
      sourceId: "test-source",
      sourceType: "system",
      targetId: unit.id,
      type: "affiliation",
      key: "arie-family",
      operation: "add",
    });

    expect(() =>
      RequirementValidator.validate([hasAlly({ affiliation: "arie-family" }, "arie family member")], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  // ── first_card_this_round ─────────────────────────────────────────────────

  test("first_card_this_round — passes when no cards played", () => {
    game._cardsPlayedThisRound.set("Alice", 0);
    expect(() =>
      RequirementValidator.validate([firstCard()], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("first_card_this_round — throws when cards already played", () => {
    game._cardsPlayedThisRound.set("Alice", 2);
    expect(() =>
      RequirementValidator.validate([firstCard()], { gameState: game, username: "Alice" })
    ).toThrow(/first card/i);
  });

  // ── Contract ──────────────────────────────────────────────────────────────

  test("unknown requirement type throws", () => {
    expect(() =>
      RequirementValidator.validate([{ type: "banana", raw: "mystery" }], { gameState: game, username: "Alice" })
    ).toThrow(/unsupported requirement type/i);
  });

  test("empty requirements pass", () => {
    expect(() => RequirementValidator.validate([], { gameState: game, username: "Alice" })).not.toThrow();
    expect(() => RequirementValidator.validate(null, { gameState: game, username: "Alice" })).not.toThrow();
  });
});
