import RequirementValidator from "../services/RequirementValidator.js";
import { setupGameWithCardsInHand } from "./utils.js";

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
