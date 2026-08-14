import { jest } from "@jest/globals";
import CreateIncinerateHandler from "../../handlers/CreateIncinerateHandler.js";
import EVT from "../../EventCatalog.js";
import { setupGameWithCardsInHand } from "../utils.js";

describe("CreateIncinerateHandler", () => {
  let game, handler;

  beforeEach(() => {
    game = setupGameWithCardsInHand(["Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa", "Yeon Yihwa"]);
    handler = new CreateIncinerateHandler();
  });

  function context() {
    return { emitChild: jest.fn() };
  }

  test("creates the highest affordable Incinerate when charges are available", () => {
    game.playerStates.Alice.fireCharges = 5; // afford Incinerate III
    const ctx = context();

    const result = handler.execute({ owner: "Alice" }, ctx, game);

    expect(result.created).toBe(true);
    expect(result.level).toBe(3);
    expect(result.name).toBe("Incinerate III");
    expect(result.incinerate.name).toBe("Incinerate III");
    // 5 charges consumed
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("skips with a reason when there are not enough charges", () => {
    game.playerStates.Alice.fireCharges = 0;
    const ctx = context();

    const result = handler.execute({ owner: "Alice" }, ctx, game);

    expect(result.created).toBe(false);
    expect(result.reason).toContain("Not enough Fire Charges");
    expect(ctx.emitChild).toHaveBeenCalledWith(EVT.HWAYEOMSA_INCINERATE_CREATED, {
      username: "Alice",
      level: 0,
      chargesRemaining: 0,
      skipped: true,
      reason: "not enough fire charges",
    });
  });

  test("uses the lowest available level when only one charge", () => {
    game.playerStates.Alice.fireCharges = 1;
    const result = handler.execute({ owner: "Alice" }, context(), game);

    expect(result.created).toBe(true);
    expect(result.level).toBe(1);
    expect(result.name).toBe("Incinerate I");
    expect(game.playerStates.Alice.fireCharges).toBe(0);
  });

  test("validate requires owner", () => {
    expect(() => handler.validate({})).toThrow("payload.owner is required");
  });

  test("execute throws when the Hwayeomsa engine is not registered", () => {
    game._attributeRegistry._engines.delete("hwayeomsa");

    expect(() => handler.execute({ owner: "Alice" }, context(), game)).toThrow("Hwayeomsa engine not registered");
  });
});
