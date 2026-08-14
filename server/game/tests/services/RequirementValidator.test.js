import RequirementValidator from "../../services/RequirementValidator.js";
import { setupGameWithCardsInHand } from "../utils.js";

describe("RequirementValidator", () => {
  let game;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Yeon Yihwa", "Khun Aguero Agnes", "Khun Aguero Agnes", "Khun Aguero Agnes"]);
  });

  // ── Already handled patterns ──────────────────────────────────────────────

  test("deployed as position — passes when correct", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    const unit = game.playerStates.Alice.field.frontline[0];
    expect(() =>
      RequirementValidator.validate(["deployed as fisherman"], { gameState: game, username: "Alice", sourceUnit: unit })
    ).not.toThrow();
  });

  test("deployed as position — throws when wrong", () => {
    const unit = { id: "u1", owner: "Alice", placedPositionCode: "scout" };
    expect(() =>
      RequirementValidator.validate(["deployed as Fisherman"], { gameState: game, username: "Alice", sourceUnit: unit })
    ).toThrow(/deployed as fisherman/i);
  });

  test("target is an ally — passes when correct", () => {
    const ally = { id: "u2", owner: "Alice", card: {} };
    const source = { id: "u1", owner: "Alice", card: {} };
    expect(() =>
      RequirementValidator.validate(["target is an ally"], { gameState: game, username: "Alice", sourceUnit: source, targetUnit: ally })
    ).not.toThrow();
  });

  test("target is an ally — throws when target is enemy", () => {
    const enemy = { id: "u2", owner: "Bob", card: {} };
    const source = { id: "u1", owner: "Alice", card: {} };
    expect(() =>
      RequirementValidator.validate(["target is an ally"], { gameState: game, username: "Alice", sourceUnit: source, targetUnit: enemy })
    ).toThrow(/must be an ally/i);
  });

  // ── New patterns ──────────────────────────────────────────────────────────

  test("specific unit name on board — passes when present", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate(["Yeon Yihwa is in your board"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("specific unit name on board — throws when absent", () => {
    expect(() =>
      RequirementValidator.validate(["Yeon Woon is in your board"], { gameState: game, username: "Alice" })
    ).toThrow(/Yeon Woon.*board/i);
  });

  test("bare affiliation — passes when present", () => {
    game.round = 3;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 3, recharged: 0 };
    // Deploy Khun Aguero Agnes (has khun-family affiliation)
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Khun Aguero Agnes");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: khunIdx, placedPositionCode: "light-bearer" } });

    expect(() =>
      RequirementValidator.validate(["khun family member"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("bare affiliation — throws when absent", () => {
    expect(() =>
      RequirementValidator.validate(["arie family member"], { gameState: game, username: "Alice" })
    ).toThrow(/arie family/i);
  });

  test("affiliation or attribute — passes when attribute matches", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate(["you have an ally yeon family member or Hwayeomsa"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("affiliation or attribute — throws when neither", () => {
    expect(() =>
      RequirementValidator.validate(["you have an ally hendo lok family member or anima"], { gameState: game, username: "Alice" })
    ).toThrow(/hendo lok/i);
  });

  test("ally with attribute — passes when present", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: 0, placedPositionCode: "fisherman" } });

    expect(() =>
      RequirementValidator.validate(["have an ally Hwayeomsa"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("ally with attribute — throws when absent", () => {
    expect(() =>
      RequirementValidator.validate(["have an ally Irregular"], { gameState: game, username: "Alice" })
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

  test("ally with attribute — passes when the attribute is modifier-granted, not on the card", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    // Khun Aguero Agnes has no "hwayeomsa" attribute on her compiled card.
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Khun Aguero Agnes");
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
      RequirementValidator.validate(["have an ally Hwayeomsa"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("affiliation or attribute — passes when the attribute branch is satisfied only via ModifierStack", () => {
    game.round = 5;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 5, recharged: 0 };
    const khunIdx = game.playerStates.Alice.hand.findIndex((c) => c.name === "Khun Aguero Agnes");
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
      RequirementValidator.validate(["you have an ally yeon family member or anima"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("bare affiliation — passes when only ModifierStack-granted", () => {
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
      RequirementValidator.validate(["arie family member"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("first card of round — passes when no cards played", () => {
    game._cardsPlayedThisRound.set("Alice", 0);
    expect(() =>
      RequirementValidator.validate(["I'm the first card you play this round"], { gameState: game, username: "Alice" })
    ).not.toThrow();
  });

  test("first card of round — throws when cards already played", () => {
    game._cardsPlayedThisRound.set("Alice", 2);
    expect(() =>
      RequirementValidator.validate(["I'm the first card you play this round"], { gameState: game, username: "Alice" })
    ).toThrow(/first card/i);
  });

  test("unknown requirement throws", () => {
    expect(() =>
      RequirementValidator.validate(["unknown custom requirement"], { gameState: game, username: "Alice" })
    ).toThrow(/unsupported requirement/i);
  });

  test("empty requirements pass", () => {
    expect(() => RequirementValidator.validate([], { gameState: game, username: "Alice" })).not.toThrow();
    expect(() => RequirementValidator.validate(null, { gameState: game, username: "Alice" })).not.toThrow();
  });
});
