import { jest } from "@jest/globals";
import CreateCardHandler from "../../handlers/CreateCardHandler.js";
import EVT from "../../EventCatalog.js";
import { setupGameWithCardsInHand } from "../utils.js";

describe("CreateCardHandler", () => {
  let game, handler;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa"]);
    handler = new CreateCardHandler();
  });

  function context() {
    return { emitChild: jest.fn() };
  }

  test("plain create: creates an exact-named card in hand and emits card:created", () => {
    const ctx = context();
    const result = handler.execute(
      { owner: "Alice", card: { name: "Shinwonryu" }, raw: "create Shinwonryu in your hand" },
      ctx,
      game
    );

    expect(result.created).toBe(true);
    expect(result.card.name).toBe("Shinwonryu");
    expect(game.playerStates.Alice.hand.some((card) => card.name === "Shinwonryu")).toBe(true);
    expect(ctx.emitChild).toHaveBeenCalledWith(EVT.CARD_CREATED, {
      owner: "Alice",
      cardId: expect.any(Number),
      name: "Shinwonryu",
    });
  });

  test("plain create honors the card type filter", () => {
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", name: "Shinwonryu" } },
      context(),
      game
    );
    expect(result.created).toBe(true);
    expect(result.card.type).toBe("skill");
  });

  test("generated_by fire_charge family creates the highest affordable Incinerate and consumes charges", () => {
    game.playerStates.Alice.fireCharges = 5;
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", name: "Incinerate" } },
      context(),
      game
    );

    expect(result.created).toBe(true);
    expect(result.level).toBe(3);
    expect(result.name).toBe("Incinerate III");
    expect(result.card.name).toBe("Incinerate III");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
    expect(game.playerStates.Alice.hand.some((card) => card.name === "Incinerate III")).toBe(true);
  });

  test("generated_by with insufficient charges skips and does not consume charges", () => {
    game.playerStates.Alice.fireCharges = 0;
    const ctx = context();
    const result = handler.execute(
      { owner: "Alice", card: { type: "skill", name: "Incinerate" } },
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
      { owner: "Alice", card: { type: "skill", name: "Incinerate" } },
      context(),
      game
    );

    expect(result.created).toBe(true);
    expect(result.level).toBe(1);
    expect(result.card.name).toBe("Incinerate I");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("choose card target defers to a card_selection decision and creates the chosen card", () => {
    const result = handler.execute(
      { owner: "Alice", card: { type: "equipment", name: "Thorn Fragment", choose: true } },
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
      { owner: "Alice", card: { type: "equipment", name: "Thorn Fragment", random: true } },
      context(),
      game
    );

    expect(result.created).toBe(true);
    expect(["First Thorn Fragment", "Second Thorn Fragment", "Third Thorn Fragment", "Fourth Thorn Fragment"])
      .toContain(result.card.name);
  });

  test("unknown generated_by resource is skipped", () => {
    const cards = { ...game.constructor.cards };
    cards["9999"] = {
      cardId: 9999,
      type: "skill",
      name: "Exotic",
      cost: 0,
      deckConstraints: [{ type: "generated_by", resource: "mystery", amount: 1, raw: "x" }],
    };
    game.constructor.cards = cards;

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

  test("validate requires owner and card name", () => {
    expect(() => handler.validate({ card: { name: "Baang" } })).toThrow("payload.owner is required");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("payload.card is required");
    expect(() => handler.validate({ owner: "Alice", card: {} })).toThrow("payload.card.name is required");
  });
});
