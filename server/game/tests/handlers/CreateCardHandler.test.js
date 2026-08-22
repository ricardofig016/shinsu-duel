import { jest } from "@jest/globals";
import CreateCardHandler from "../../handlers/CreateCardHandler.js";
import EVT from "../../EventCatalog.js";
import { setupGameWithCardsInHand } from "../utils.js";

describe("CreateCardHandler", () => {
  let game, handler;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Test Hwayeomsa", "Test Hwayeomsa", "Test Hwayeomsa", "Test Hwayeomsa"]);
    handler = new CreateCardHandler();
  });

  function context() {
    return { emitChild: jest.fn() };
  }

  test("plain create: creates an exact-named card in hand and emits card:created", () => {
    const ctx = context();
    const result = handler.execute(
      { owner: "Alice", card: { name: "Test Unreachable Skill" }, raw: "create Shinwonryu in your hand" },
      ctx,
      game
    );

    expect(result.created).toBe(true);
    expect(result.card.name).toBe("Test Unreachable Skill");
    expect(game.playerStates.Alice.hand.some((card) => card.name === "Test Unreachable Skill")).toBe(true);
    expect(ctx.emitChild).toHaveBeenCalledWith(EVT.CARD_CREATED, {
      owner: "Alice",
      cardId: expect.any(Number),
      name: "Test Unreachable Skill",
    });
  });

  test("plain create honors the card type filter", () => {
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", name: "Test Unreachable Skill" } },
      context(),
      game
    );
    expect(result.created).toBe(true);
    expect(result.card.type).toBe("skill");
  });

  test("generated_by fire_charge series creates the highest affordable Incinerate and consumes charges", () => {
    game.playerStates.Alice.fireCharges = 5;
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", series: "incinerate" } },
      context(),
      game
    );

    expect(result.created).toBe(true);
    expect(result.level).toBe(3);
    expect(result.name).toBe("Test Incinerate III");
    expect(result.card.name).toBe("Test Incinerate III");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
    expect(game.playerStates.Alice.hand.some((card) => card.name === "Test Incinerate III")).toBe(true);
  });

  test("generated_by with insufficient charges skips and does not consume charges", () => {
    game.playerStates.Alice.fireCharges = 0;
    const ctx = context();
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", series: "incinerate" } },
      ctx,
      game
    );

    expect(result.created).toBe(false);
    expect(result.reason).toContain("Not enough Fire Charges");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
    expect(ctx.emitChild).toHaveBeenCalledWith(EVT.HWAYEOMSA_INCINERATE_CREATED, {
      username: "Alice",
      level: 0,
      chargesRemaining: 0,
      skipped: true,
      reason: "not enough fire charges",
    });
  });

  test("generated_by with one charge creates Incinerate I", () => {
    game.playerStates.Alice.fireCharges = 1;
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", series: "incinerate" } },
      context(),
      game
    );

    expect(result.created).toBe(true);
    expect(result.level).toBe(1);
    expect(result.card.name).toBe("Test Incinerate I");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("choose card target defers to a card_selection decision and creates the chosen card", () => {
    const result = handler.execute(
      { owner: "Alice", card: { type: "equipment", series: "thorn-fragment", choose: true } },
      context(),
      game
    );

    expect(result).toEqual({ pending: true });
    expect(game.pendingDecision.type).toBe("card_selection");
    expect(game.pendingDecision.candidates).toHaveLength(4);

    const chosen = game.pendingDecision.candidates[2];
    game.resolveDecision({
      decisionId: game.pendingDecision.decisionId,
      choices: [chosen.id],
      username: "Alice",
    });

    expect(game.playerStates.Alice.hand.some((card) => card.name === chosen.name)).toBe(true);
  });

  test("random card target deterministically picks one matching card", () => {
    const result = handler.execute(
      { owner: "Alice", card: { type: "equipment", series: "thorn-fragment", random: true } },
      context(),
      game
    );

    expect(result.created).toBe(true);
    expect(["Test Thorn Fragment I", "Test Thorn Fragment II", "Test Thorn Fragment III", "Test Thorn Fragment IV"])
      .toContain(result.card.name);
  });

  test("series target resolves all cards carrying the series code", () => {
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", series: "incinerate" } },
      context(),
      game
    );

    // Incinerate cards carry generated_by, so they route through the engine.
    expect(result.created).toBe(false);
    expect(result.reason).toContain("Not enough Fire Charges");
  });

  test("validate requires name or series", () => {
    expect(() => handler.validate({ owner: "Alice", card: { type: "skill" } })).toThrow(/payload.card.name or payload.card.series is required/i);
    expect(() => handler.validate({ owner: "Alice", card: { series: "thorn-fragment" } })).not.toThrow();
    expect(() => handler.validate({ owner: "Alice", card: { name: "Test Unreachable Skill" } })).not.toThrow();
  });

  test("unknown generated_by resource is skipped", () => {
    const cards = { ...game.cards };
    cards["9999"] = {
      cardId: 9999,
      type: "skill",
      name: "Exotic",
      cost: 0,
      deckConstraints: [{ type: "generated_by", resource: "mystery", amount: 1, raw: "x" }],
    };
    game.cards = cards;

    game.eventBus.emit = jest.fn();
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", name: "Exotic" } },
      context(),
      game
    );

    expect(result.skipped).toBe(true);
    expect(game.eventBus.emit).toHaveBeenCalledWith(
      EVT.EFFECT_UNSUPPORTED,
      expect.objectContaining({ detail: 'unknown generated_by resource "mystery"' })
    );
  });

  test("returns created:false when no card matches", () => {
    const result = handler.execute(
      { owner: "Alice", card: { name: "Nonexistent" } },
      context(),
      game
    );
    expect(result.created).toBe(false);
    expect(result.reason).toContain("No card matches");
  });

  test("validate requires owner and a card name or series", () => {
    expect(() => handler.validate({ card: { name: "Baang" } })).toThrow("payload.owner is required");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("payload.card is required");
    expect(() => handler.validate({ owner: "Alice", card: {} })).toThrow("payload.card.name or payload.card.series is required");
  });
});
