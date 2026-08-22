import { setupGameWithCardsInHand } from "../utils.js";
import DisarmHandler from "../../handlers/DisarmHandler.js";

const context = (game) => ({ emitChild: (eventName, payload) => game.eventBus.emit(eventName, payload) });

function equip(game, unit) {
  game.currentTurn = "Alice";
  game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
  const equipHand = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka's Armor Suit");
  game.processAction({ type: "equip-equipment-action", data: { source: "player", username: "Alice", handId: equipHand, targetUnitId: unit.id } });
}

describe("DisarmHandler", () => {
  let handler;

  beforeEach(() => {
    handler = new DisarmHandler();
  });

  function setup() {
    const game = setupGameWithCardsInHand(["Karaka", "Karaka's Armor Suit", "Karaka"]);
    game.currentTurn = "Alice";
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const karakaHand = game.playerStates.Alice.hand.findIndex((c) => c.name === "Karaka");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId: karakaHand, placedPositionCode: "fisherman" } });
    const karaka = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Karaka");
    equip(game, karaka);
    return { game, karaka };
  }

  test("disarms to the equipment owner's hand", () => {
    const { game, karaka } = setup();
    const result = handler.execute(
      { targetId: karaka.id, to: { zone: "hand", owner: "equipment_owner" }, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.disarmed).toBe(true);
    expect(karaka.equipmentAttachments).toHaveLength(0);
    expect(game.playerStates.Alice.hand.some((c) => c.name === "Karaka's Armor Suit")).toBe(true);
  });

  test("disarms to the acting player's discard", () => {
    const { game, karaka } = setup();
    const result = handler.execute(
      { targetId: karaka.id, to: { zone: "discard", owner: "you" }, sourceOwner: "Alice" },
      context(game),
      game
    );

    expect(result.disarmed).toBe(true);
    expect(game.playerStates.Alice.discard.some((c) => c.name === "Karaka's Armor Suit")).toBe(true);
  });

  test("no-op when the target has no equipment", () => {
    const game = setupGameWithCardsInHand(["Bull", "Bull"]);
    game.currentTurn = "Alice";
    game.round = 15;
    game.playerStates.Alice.shinsu = { normalSpent: 0, normalAvailable: 15, recharged: 0 };
    const handId = game.playerStates.Alice.hand.findIndex((c) => c.name === "Bull");
    game.processAction({ type: "deploy-unit-action", data: { source: "player", username: "Alice", handId, placedPositionCode: "frontline-shinheuh" } });
    const bull = game.playerStates.Alice.field.frontline.find((u) => u.card.name === "Bull");

    expect(handler.execute({ targetId: bull.id, to: { zone: "hand", owner: "equipment_owner" }, sourceOwner: "Alice" }, context(game), game))
      .toEqual({ disarmed: false, reason: "no equipment" });
  });

  test("validate throws without targetId or to", () => {
    expect(() => handler.validate({})).toThrow("targetId");
    expect(() => handler.validate({ targetId: "U1" })).toThrow("to");
  });
});
