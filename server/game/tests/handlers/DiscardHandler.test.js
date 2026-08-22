import { setupGameWithCardsInHand } from "../utils.js";
import DiscardHandler from "../../handlers/DiscardHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

describe("DiscardHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new DiscardHandler();
  });

  test("discards a specific card instance from the hand", () => {
    const game = setupGameWithCardsInHand(["Baang", "Baang", "Baang"]);
    const card = game.playerStates.Alice.hand[0];

    const result = handler.execute(
      { owner: "Alice", card: { zone: "hand" }, targetCardId: card.id },
      context(game),
      game
    );

    expect(result.discarded).toBe(1);
    expect(game.playerStates.Alice.hand.some((c) => c.id === card.id)).toBe(false);
    expect(game.playerStates.Alice.discard.some((c) => c.id === card.id)).toBe(true);
  });

  test("discards matching bearer attachments", () => {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka"]);
    game.currentTurn = "Alice";
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const karakaHand = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: karakaHand, placedPositionCode: "fisherman" } });
    const karaka = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Karaka");

    game.currentTurn = "Alice";
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const equipHand = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
    game.processAction({ type: "equip-equipment-action", data: { source: "player", username: "Alice", handId: equipHand, targetUnitId: karaka.id } });

    const attachment = karaka.equipmentAttachments[0];
    const result = handler.execute(
      { owner: "Alice", card: { zone: "attachments" }, attachmentIds: [attachment.id], sourceUnit: karaka },
      context(game),
      game
    );

    expect(result.discarded).toBe(1);
    expect(karaka.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Alice.discard.some((c) => c.cardId === attachment.cardId)).toBe(true);
  });

  test("no-op when the target card is not in hand", () => {
    const game = setupGameWithCardsInHand(["Baang"]);
    const result = handler.execute(
      { owner: "Alice", card: { zone: "hand" }, targetCardId: "Card#Missing" },
      context(game),
      game
    );
    expect(result.discarded).toBe(0);
  });

  test("validate throws without owner or card", () => {
    expect(() => handler.validate({})).toThrow("owner");
    expect(() => handler.validate({ owner: "Alice" })).toThrow("card");
  });
});
