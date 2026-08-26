import ZoneService from "../../services/ZoneService.js";
import EVT from "../../EventCatalog.js";

describe("ZoneService", () => {
  test("draw moves cards from deck to hand", () => {
    const state = {
      deck: [{ name: "Card1" }, { name: "Card2" }, { name: "Card3" }],
      hand: [],
    };
    const result = ZoneService.draw(state, 2);
    expect(result.drawn).toBe(2);
    expect(state.hand).toHaveLength(2);
    expect(state.deck).toHaveLength(1);
  });

  test("draw emits game:deck:empty when deck exhausted", () => {
    let emittedEvent = null;
    const emitSpy = (eventName, payload) => {
      emittedEvent = { eventName, payload };
    };
    const state = {
      deck: [{ name: "Card1" }],
      hand: [],
      username: "Alice",
    };
    const gameState = { eventBus: { emit: emitSpy } };
    ZoneService.draw(state, 2, gameState);
    expect(state.deck).toHaveLength(0);
    expect(state.hand).toHaveLength(1);
    expect(emittedEvent.eventName).toBe(EVT.GAME_DECK_EMPTY);
  });

  test("discard adds card to discard pile", () => {
    const state = { discard: [] };
    const card = { name: "Card1" };
    ZoneService.discard(state, card);
    expect(state.discard).toHaveLength(1);
    expect(state.discard[0].name).toBe("Card1");
  });

  test("reclaimTop moves top card from discard to hand", () => {
    const state = {
      discard: [{ name: "CardA" }, { name: "CardB" }],
      hand: [{ name: "Existing" }],
    };
    const card = ZoneService.reclaimTop(state);
    expect(card.name).toBe("CardB");
    expect(state.discard).toHaveLength(1);
    expect(state.hand).toHaveLength(2);
  });

  test("reclaimTop returns null when discard empty", () => {
    const state = { discard: [], hand: [] };
    const card = ZoneService.reclaimTop(state);
    expect(card).toBeNull();
  });

  test("addToHand adds card", () => {
    const state = { hand: [{ name: "Existing" }] };
    ZoneService.addToHand(state, { name: "NewCard" });
    expect(state.hand).toHaveLength(2);
  });
});
